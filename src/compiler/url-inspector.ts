import * as cheerio from 'cheerio';
import YAML from 'yaml';
import {
  extractHydrationFromHtml,
  extractJsonLdFromHtml,
  extractMetaFromHtml,
} from '../engine/tier2-extract.js';
import { DEFAULT_USER_AGENT } from '../engine/tier1-http.js';
import { Blueprint, OutputPropertySchema } from '../schema/blueprint.js';
import { z } from 'zod';

export interface RepeatableDomCandidate {
  rootSelector: string;
  count: number;
  sampleFields: Record<string, { selector: string; attribute?: string; sample: string }>;
}

export interface UrlInspectionReport {
  url: string;
  contentType: string;
  recommendedTier: 'http' | 'extract';
  recommendedStrategy: 'json' | 'hydration' | 'json-ld' | 'css' | 'meta';
  hasDirectJson: boolean;
  hasHydrationState: boolean;
  hydrationKeys: string[];
  jsonLdCount: number;
  jsonLdTypes: string[];
  metaSummary: Record<string, unknown>;
  repeatableDomCandidates: RepeatableDomCandidate[];
  generatedBlueprint: Blueprint;
  generatedYaml: string;
}

/**
 * Infers output properties from a sample JavaScript object.
 */
export function inferOutputPropertiesFromObject(
  sample: Record<string, unknown>
): Record<string, z.infer<typeof OutputPropertySchema>> {
  const props: Record<string, z.infer<typeof OutputPropertySchema>> = {};
  for (const [k, v] of Object.entries(sample)) {
    if (v === null || v === undefined) {
      props[k] = { type: 'any', nullable: true };
    } else if (Array.isArray(v)) {
      props[k] = { type: 'array' };
    } else if (typeof v === 'number') {
      props[k] = { type: 'number' };
    } else if (typeof v === 'boolean') {
      props[k] = { type: 'boolean' };
    } else if (typeof v === 'object') {
      props[k] = { type: 'object' };
    } else {
      props[k] = { type: 'string' };
    }
  }
  return props;
}

/**
 * Scans HTML for repeating card/row/item structures and infers child CSS selectors.
 */
export function detectRepeatableDomStructures(html: string): RepeatableDomCandidate[] {
  const $ = cheerio.load(html);
  const candidates: RepeatableDomCandidate[] = [];
  const seenSelectors = new Set<string>();

  const candidateSelectors = [
    'article',
    'main li',
    'table tbody tr',
    '[role="listitem"]',
    'div[class*="card"]',
    'div[class*="item"]',
    'div[class*="row"]',
    'li[class]',
  ];

  for (const sel of candidateSelectors) {
    const els = $(sel);
    if (els.length < 3) continue;

    // Refine selector with first class name if generic
    const firstEl = els.first();
    const tag = firstEl.prop('tagName')?.toLowerCase() ?? 'div';
    const classAttr = (firstEl.attr('class') ?? '').trim().split(/\s+/)[0];
    const specificSelector =
      classAttr && !classAttr.includes(':') ? `${tag}.${classAttr}` : sel;

    if (seenSelectors.has(specificSelector)) continue;
    const matched = $(specificSelector);
    if (matched.length < 3) continue;

    const sampleEl = matched.first();
    const sampleFields: RepeatableDomCandidate['sampleFields'] = {};

    const heading = sampleEl.find('h1, h2, h3, h4').first();
    if (heading.length > 0 && heading.text().trim()) {
      const hTag = heading.prop('tagName')?.toLowerCase() ?? 'h2';
      sampleFields.title = {
        selector: hTag,
        sample: heading.text().trim().slice(0, 80),
      };
    }

    const link = sampleEl.find('a[href]').first();
    if (link.length > 0) {
      if (!sampleFields.title && link.text().trim()) {
        sampleFields.title = {
          selector: 'a[href]',
          sample: link.text().trim().slice(0, 80),
        };
      }
      sampleFields.url = {
        selector: 'a[href]',
        attribute: 'href',
        sample: (link.attr('href') ?? '').slice(0, 100),
      };
    }

    const paragraph = sampleEl.find('p').first();
    if (paragraph.length > 0 && paragraph.text().trim()) {
      sampleFields.description = {
        selector: 'p',
        sample: paragraph.text().trim().slice(0, 100),
      };
    }

    if (Object.keys(sampleFields).length >= 1) {
      seenSelectors.add(specificSelector);
      candidates.push({
        rootSelector: specificSelector,
        count: matched.length,
        sampleFields,
      });
    }
  }

  return candidates.sort((a, b) => {
    const fieldDiff =
      Object.keys(b.sampleFields).length - Object.keys(a.sampleFields).length;
    return fieldDiff !== 0 ? fieldDiff : b.count - a.count;
  });
}

function slugifyHostAndPath(targetUrl: string): { id: string; name: string } {
  try {
    const u = new URL(targetUrl);
    const hostParts = u.hostname.replace(/^www\./, '').split('.');
    const namespace = (hostParts[0] || 'site')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
    const pathSlug = u.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 2)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
    const nameSlug = pathSlug || 'extract';
    return {
      id: `${namespace}/${nameSlug}`,
      name: `${namespace.charAt(0).toUpperCase() + namespace.slice(1)} ${nameSlug.replace(/-/g, ' ')}`,
    };
  } catch {
    return { id: 'custom/site-extract', name: 'Custom Site Extract' };
  }
}

/**
 * Inspects a live URL (or provided HTML/JSON content) and automatically generates
 * an optimal OpenAct Blueprint (.act.yaml).
 */
export async function inspectUrlAndGenerateBlueprint(
  targetUrl: string,
  options?: { rawBody?: string; contentType?: string }
): Promise<UrlInspectionReport> {
  let bodyText = options?.rawBody;
  let contentType = options?.contentType ?? '';

  if (bodyText === undefined) {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
    });
    bodyText = await response.text();
    contentType = response.headers.get('content-type') ?? '';
  }

  const { id, name } = slugifyHostAndPath(targetUrl);

  // Case 1: Direct JSON response
  let parsedJson: unknown = null;
  if (contentType.includes('application/json') || bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
    try {
      parsedJson = JSON.parse(bodyText);
    } catch {
      parsedJson = null;
    }
  }

  if (parsedJson !== null) {
    const isArray = Array.isArray(parsedJson);
    const sampleObj = isArray
      ? ((parsedJson as unknown[])[0] as Record<string, unknown> | undefined)
      : (parsedJson as Record<string, unknown>);
    const fieldKeys =
      sampleObj && typeof sampleObj === 'object'
        ? Object.keys(sampleObj).slice(0, 8)
        : [];
    const fields = fieldKeys.reduce<Record<string, string>>((acc, k) => {
      acc[k] = k;
      return acc;
    }, {});

    const blueprint: Blueprint = {
      id,
      name,
      version: '1.0.0',
      description: `Deterministic JSON API blueprint for ${targetUrl}`,
      category: 'auto-generated',
      author: 'openact-inspector',
      tags: ['json', 'http'],
      homepage: targetUrl,
      cacheTtlSeconds: 60,
      inputs: {},
      execution: {
        mode: 'http',
        request: {
          url: targetUrl,
          method: 'GET',
          timeoutMs: 15000,
        },
        http: {
          responseType: 'json',
          multiple: isArray,
          limit: isArray ? 25 : undefined,
          fields: Object.keys(fields).length > 0 ? fields : undefined,
        },
      },
      output: sampleObj
        ? isArray
          ? {
              type: 'array',
              items: {
                type: 'object',
                properties: inferOutputPropertiesFromObject(sampleObj),
              },
            }
          : {
              type: 'object',
              properties: inferOutputPropertiesFromObject(sampleObj),
            }
        : { type: 'any' },
      tests: [],
    };

    return {
      url: targetUrl,
      contentType: contentType || 'application/json',
      recommendedTier: 'http',
      recommendedStrategy: 'json',
      hasDirectJson: true,
      hasHydrationState: false,
      hydrationKeys: [],
      jsonLdCount: 0,
      jsonLdTypes: [],
      metaSummary: {},
      repeatableDomCandidates: [],
      generatedBlueprint: blueprint,
      generatedYaml: YAML.stringify(blueprint, { indent: 2 }),
    };
  }

  // Case 2: HTML document analysis
  const hydration = extractHydrationFromHtml(bodyText);
  const jsonLdBlocks = extractJsonLdFromHtml(bodyText);
  const metaSummary = extractMetaFromHtml(bodyText);
  const domCandidates = detectRepeatableDomStructures(bodyText);

  const hydrationKeys =
    hydration && typeof hydration === 'object' && !Array.isArray(hydration)
      ? Object.keys(hydration as Record<string, unknown>)
      : [];

  const jsonLdTypes = jsonLdBlocks
    .map((b) =>
      b && typeof b === 'object' && '@type' in b ? String((b as Record<string, unknown>)['@type']) : null
    )
    .filter((t): t is string => Boolean(t));

  let recommendedStrategy: UrlInspectionReport['recommendedStrategy'] = 'meta';
  let blueprint: Blueprint;

  if (domCandidates.length > 0) {
    recommendedStrategy = 'css';
    const best = domCandidates[0];
    const fields: Record<string, { selector: string; attribute?: string; transform: ['trim'] }> = {};
    for (const [k, v] of Object.entries(best.sampleFields)) {
      fields[k] = {
        selector: v.selector,
        ...(v.attribute ? { attribute: v.attribute } : {}),
        transform: ['trim'],
      };
    }

    blueprint = {
      id,
      name,
      version: '1.0.0',
      description: `Extracts repeating items (${best.rootSelector}) from ${targetUrl}`,
      category: 'auto-generated',
      author: 'openact-inspector',
      tags: ['html', 'css'],
      homepage: targetUrl,
      cacheTtlSeconds: 120,
      inputs: {},
      execution: {
        mode: 'extract',
        request: {
          url: targetUrl,
          method: 'GET',
          timeoutMs: 15000,
        },
        extract: {
          strategy: 'css',
          root: best.rootSelector,
          multiple: true,
          limit: 25,
          fields,
        },
      },
      output: {
        type: 'array',
        items: {
          type: 'object',
          properties: Object.keys(fields).reduce<
            Record<string, z.infer<typeof OutputPropertySchema>>
          >((acc, k) => {
            acc[k] = { type: 'string', nullable: true };
            return acc;
          }, {}),
        },
      },
      tests: [],
    };
  } else if (jsonLdBlocks.length > 0) {
    recommendedStrategy = 'json-ld';
    blueprint = {
      id,
      name,
      version: '1.0.0',
      description: `Extracts Schema.org JSON-LD structured data from ${targetUrl}`,
      category: 'auto-generated',
      author: 'openact-inspector',
      tags: ['json-ld', 'schema-org'],
      homepage: targetUrl,
      cacheTtlSeconds: 300,
      inputs: {},
      execution: {
        mode: 'extract',
        request: {
          url: targetUrl,
          method: 'GET',
          timeoutMs: 15000,
        },
        extract: {
          strategy: 'json-ld',
          multiple: jsonLdBlocks.length > 1,
        },
      },
      output: { type: jsonLdBlocks.length > 1 ? 'array' : 'object' },
      tests: [],
    };
  } else if (hydration !== null) {
    recommendedStrategy = 'hydration';
    blueprint = {
      id,
      name,
      version: '1.0.0',
      description: `Extracts embedded hydration state from ${targetUrl}`,
      category: 'auto-generated',
      author: 'openact-inspector',
      tags: ['hydration', 'next-data'],
      homepage: targetUrl,
      cacheTtlSeconds: 120,
      inputs: {},
      execution: {
        mode: 'extract',
        request: {
          url: targetUrl,
          method: 'GET',
          timeoutMs: 15000,
        },
        extract: {
          strategy: 'hydration',
          multiple: false,
        },
      },
      output: { type: 'object' },
      tests: [],
    };
  } else {
    recommendedStrategy = 'meta';
    blueprint = {
      id,
      name,
      version: '1.0.0',
      description: `Extracts OpenGraph and page metadata from ${targetUrl}`,
      category: 'auto-generated',
      author: 'openact-inspector',
      tags: ['metadata', 'opengraph'],
      homepage: targetUrl,
      cacheTtlSeconds: 300,
      inputs: {},
      execution: {
        mode: 'extract',
        request: {
          url: targetUrl,
          method: 'GET',
          timeoutMs: 15000,
        },
        extract: {
          strategy: 'meta',
          multiple: false,
          fields: {
            title: 'title',
            description: 'description',
            canonical: 'canonical',
            og: 'og',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          title: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          canonical: { type: 'string', nullable: true },
          og: { type: 'object', nullable: true },
        },
      },
      tests: [],
    };
  }

  return {
    url: targetUrl,
    contentType: contentType || 'text/html',
    recommendedTier: 'extract',
    recommendedStrategy,
    hasDirectJson: false,
    hasHydrationState: hydration !== null,
    hydrationKeys,
    jsonLdCount: jsonLdBlocks.length,
    jsonLdTypes,
    metaSummary,
    repeatableDomCandidates: domCandidates,
    generatedBlueprint: blueprint,
    generatedYaml: YAML.stringify(blueprint, { indent: 2 }),
  };
}
