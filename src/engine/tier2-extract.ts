import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import {
  ExtractExecutionSpec,
  FieldMapping,
  RequestSpec,
} from '../schema/blueprint.js';
import { TemplateContext } from './template.js';
import { performHttpFetch } from './tier1-http.js';
import {
  applyTransforms,
  extractFieldsFromJson,
  getByPath,
} from './transforms.js';

/**
 * Extracts structured JSON-LD (`application/ld+json`) objects from HTML.
 */
export function extractJsonLdFromHtml(html: string): unknown[] {
  const $ = cheerio.load(html);
  const results: unknown[] = [];

  $('script[type="application/ld+json"]').each((_idx, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else if (parsed && typeof parsed === 'object' && '@graph' in parsed && Array.isArray(parsed['@graph'])) {
        results.push(...parsed['@graph']);
      } else {
        results.push(parsed);
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  });

  return results;
}

/**
 * Extracts framework hydration state (Next.js `__NEXT_DATA__`, Nuxt, Remix, or custom script ID) from HTML.
 */
export function extractHydrationFromHtml(
  html: string,
  hydrationKey?: string
): unknown {
  const $ = cheerio.load(html);

  // 1. Check explicit script#id or default #__NEXT_DATA__
  const scriptId = hydrationKey ?? '__NEXT_DATA__';
  const nextDataEl = $(`script#${scriptId}`);
  if (nextDataEl.length > 0) {
    try {
      return JSON.parse(nextDataEl.contents().text().trim());
    } catch {
      // continue
    }
  }

  // 2. Check other application/json script blocks
  const jsonScripts: unknown[] = [];
  $('script[type="application/json"]').each((_i, el) => {
    const text = $(el).contents().text().trim();
    if (!text) return;
    try {
      jsonScripts.push(JSON.parse(text));
    } catch {
      // ignore
    }
  });
  if (jsonScripts.length === 1) return jsonScripts[0];
  if (jsonScripts.length > 1) return jsonScripts;

  // 3. Check inline window.__INITIAL_STATE__ / window.__remixContext patterns
  const scriptsText = $('script')
    .map((_i, el) => $(el).contents().text())
    .get()
    .join('\n');

  const patterns = [
    /window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/,
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:\n|window\.|$)/,
    /window\.__remixContext\s*=\s*(\{[\s\S]*?\});?\s*(?:\n|window\.|$)/,
  ];

  for (const pattern of patterns) {
    const match = scriptsText.match(pattern);
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // continue
      }
    }
  }

  return null;
}

/**
 * Extracts OpenGraph, Twitter Card, standard Meta tags, Title, and Canonical URL from HTML.
 */
export function extractMetaFromHtml(html: string): Record<string, unknown> {
  const $ = cheerio.load(html);
  const meta: Record<string, unknown> = {
    title: $('title').first().text().trim() || null,
    description:
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      null,
    canonical: $('link[rel="canonical"]').attr('href') || null,
    og: {} as Record<string, string>,
    twitter: {} as Record<string, string>,
  };

  $('meta').each((_i, el) => {
    const prop = $(el).attr('property') || $(el).attr('name');
    const content = $(el).attr('content');
    if (!prop || content === undefined) return;

    if (prop.startsWith('og:')) {
      (meta.og as Record<string, string>)[prop.slice(3)] = content;
    } else if (prop.startsWith('twitter:')) {
      (meta.twitter as Record<string, string>)[prop.slice(8)] = content;
    } else if (!(prop in meta)) {
      meta[prop] = content;
    }
  });

  return meta;
}

/**
 * Evaluates a single FieldMapping against a Cheerio element scope.
 */
function extractFieldFromCheerioScope(
  $: cheerio.CheerioAPI,
  scopeEl: cheerio.Cheerio<AnyNode>,
  mapping: FieldMapping
): unknown {
  if (typeof mapping === 'string') {
    const target = mapping === '$' || mapping === '.' ? scopeEl : scopeEl.find(mapping).first();
    const text = target.text().trim();
    return text === '' ? null : text;
  }

  if (mapping.constant !== undefined) {
    return mapping.constant;
  }

  const sel = mapping.selector ?? mapping.path;
  const target = !sel || sel === '$' || sel === '.' ? scopeEl : scopeEl.find(sel);

  if (mapping.multiple) {
    const values: unknown[] = [];
    target.each((_idx, el) => {
      const itemEl = $(el);
      let raw: string | undefined;
      if (mapping.attribute) {
        raw = itemEl.attr(mapping.attribute);
      } else if (mapping.html) {
        raw = itemEl.html() ?? undefined;
      } else {
        raw = itemEl.text();
      }
      if (raw !== undefined) {
        values.push(applyTransforms(raw, mapping.transform));
      }
    });
    return values.length > 0 ? values : (mapping.default ?? []);
  }

  const first = target.first();
  if (first.length === 0) {
    return mapping.default ?? null;
  }

  let rawVal: string | undefined;
  if (mapping.attribute) {
    rawVal = first.attr(mapping.attribute);
  } else if (mapping.html) {
    rawVal = first.html() ?? undefined;
  } else {
    rawVal = first.text();
  }

  return applyTransforms(rawVal, mapping.transform, mapping.default);
}

/**
 * Runs HTML extraction according to an ExtractExecutionSpec.
 */
export function extractFromHtml(html: string, spec: ExtractExecutionSpec): unknown {
  const strategy = spec.strategy ?? 'css';

  if (strategy === 'json-ld') {
    const ldBlocks = extractJsonLdFromHtml(html);
    const rootData = spec.rootPath
      ? getByPath(ldBlocks.length === 1 ? ldBlocks[0] : ldBlocks, spec.rootPath)
      : ldBlocks.length === 1 && !spec.multiple
        ? ldBlocks[0]
        : ldBlocks;

    if (spec.multiple) {
      const arr = Array.isArray(rootData) ? rootData : rootData ? [rootData] : [];
      const limited = spec.limit ? arr.slice(0, spec.limit) : arr;
      return limited.map((item) => extractFieldsFromJson(item, spec.fields));
    }
    return extractFieldsFromJson(rootData, spec.fields);
  }

  if (strategy === 'hydration') {
    const hydrated = extractHydrationFromHtml(html, spec.hydrationKey);
    if (!hydrated) {
      throw new Error('No hydration state (__NEXT_DATA__ or JSON script) found in HTML.');
    }
    const target = spec.rootPath ? getByPath(hydrated, spec.rootPath) : hydrated;
    if (spec.multiple) {
      const arr = Array.isArray(target) ? target : target ? [target] : [];
      const limited = spec.limit ? arr.slice(0, spec.limit) : arr;
      return limited.map((item) => extractFieldsFromJson(item, spec.fields));
    }
    return extractFieldsFromJson(target, spec.fields);
  }

  if (strategy === 'meta') {
    const meta = extractMetaFromHtml(html);
    return extractFieldsFromJson(meta, spec.fields);
  }

  if (strategy === 'auto') {
    const hydration = extractHydrationFromHtml(html);
    const jsonLd = extractJsonLdFromHtml(html);
    const meta = extractMetaFromHtml(html);
    return {
      meta,
      jsonLd,
      hydration,
    };
  }

  // Default: 'css' strategy via Cheerio
  const $ = cheerio.load(html);
  const rootSelector = spec.root ?? 'body';

  if (spec.multiple) {
    const items: unknown[] = [];
    const matched = $(rootSelector);
    matched.each((idx, el) => {
      if (spec.limit && idx >= spec.limit) return false;
      const scopeEl = $(el);
      if (!spec.fields || Object.keys(spec.fields).length === 0) {
        items.push(scopeEl.text().trim());
      } else {
        const record: Record<string, unknown> = {};
        for (const [fieldKey, fieldMap] of Object.entries(spec.fields)) {
          record[fieldKey] = extractFieldFromCheerioScope($, scopeEl, fieldMap);
        }
        items.push(record);
      }
    });
    return items;
  }

  const rootScope = $(rootSelector).first();
  if (!spec.fields || Object.keys(spec.fields).length === 0) {
    return rootScope.text().trim();
  }

  const record: Record<string, unknown> = {};
  for (const [fieldKey, fieldMap] of Object.entries(spec.fields)) {
    record[fieldKey] = extractFieldFromCheerioScope($, rootScope, fieldMap);
  }
  return record;
}

/**
 * Tier 2 Executor: Fetches HTML and extracts structured data via CSS, JSON-LD, Hydration, or Meta tags.
 */
export async function executeTier2Extract(options: {
  requestSpec?: RequestSpec;
  extractSpec?: ExtractExecutionSpec;
  ctx: TemplateContext;
  vaultHeaders?: Record<string, string>;
  mockResponse?: unknown;
}): Promise<unknown> {
  const { requestSpec, extractSpec, ctx, vaultHeaders, mockResponse } = options;

  let html: string;
  if (typeof mockResponse === 'string') {
    html = mockResponse;
  } else if (mockResponse !== undefined) {
    html = JSON.stringify(mockResponse);
  } else {
    if (!requestSpec) {
      throw new Error('Tier 2 (extract) execution requires a `request` specification.');
    }
    const res = await performHttpFetch(
      {
        ...requestSpec,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(requestSpec.headers ?? {}),
        },
      },
      ctx,
      vaultHeaders
    );
    html = res.bodyText;
  }

  return extractFromHtml(
    html,
    extractSpec ?? { strategy: 'auto', multiple: false }
  );
}
