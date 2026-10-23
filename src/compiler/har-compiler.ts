import YAML from 'yaml';
import { Blueprint, InputParam } from '../schema/blueprint.js';
import { inferOutputPropertiesFromObject } from './url-inspector.js';

export interface HarEntry {
  request: {
    method: string;
    url: string;
    headers?: Array<{ name: string; value: string }>;
    queryString?: Array<{ name: string; value: string }>;
    postData?: {
      mimeType?: string;
      text?: string;
    };
  };
  response: {
    status: number;
    content: {
      size?: number;
      mimeType?: string;
      text?: string;
    };
  };
}

export interface HarFile {
  log: {
    entries: HarEntry[];
  };
}

export interface HarCandidateEndpoint {
  index: number;
  method: string;
  url: string;
  status: number;
  mimeType: string;
  score: number;
  rootPath?: string;
  isArray: boolean;
  sampleItemCount: number;
}

export interface HarCompilationResult {
  candidates: HarCandidateEndpoint[];
  selectedCandidate: HarCandidateEndpoint;
  authHeadersDetected: string[];
  generatedBlueprint: Blueprint;
  generatedYaml: string;
}

const IGNORED_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm|map)(\?|$)/i;
const IGNORED_DOMAINS = /(google-analytics\.com|doubleclick\.net|sentry\.io|segment\.io|hotjar\.com|intercom\.io|cloudflareinsights\.com)/i;
const IGNORED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'user-agent',
  'accept-encoding',
  'accept-language',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'pragma',
  'cache-control',
  'priority',
]);

/**
 * Finds the best root array inside a JSON payload (e.g. `data.items`, `results`, `data`, or `$`).
 */
function detectBestJsonRoot(payload: unknown): {
  rootPath?: string;
  isArray: boolean;
  sampleItem?: Record<string, unknown>;
  count: number;
} {
  if (Array.isArray(payload)) {
    const first = payload[0];
    return {
      rootPath: undefined,
      isArray: true,
      sampleItem:
        first && typeof first === 'object' && !Array.isArray(first)
          ? (first as Record<string, unknown>)
          : undefined,
      count: payload.length,
    };
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    // Check top-level array properties
    for (const [k, v] of Object.entries(record)) {
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
        return {
          rootPath: k,
          isArray: true,
          sampleItem: v[0] as Record<string, unknown>,
          count: v.length,
        };
      }
    }
    // Check 2-level nested array properties (e.g. data.children, data.items)
    for (const [k, v] of Object.entries(record)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
          if (
            Array.isArray(subV) &&
            subV.length > 0 &&
            typeof subV[0] === 'object' &&
            subV[0] !== null
          ) {
            return {
              rootPath: `${k}.${subK}`,
              isArray: true,
              sampleItem: subV[0] as Record<string, unknown>,
              count: subV.length,
            };
          }
        }
      }
    }

    return {
      rootPath: undefined,
      isArray: false,
      sampleItem: record,
      count: 1,
    };
  }

  return { isArray: false, count: 0 };
}

/**
 * Analyzes a HAR file, ranks JSON/API requests, and compiles the best matching entry
 * into a deterministic Tier-1 `http` OpenAct Blueprint.
 */
export function compileHarToBlueprint(
  har: HarFile,
  options?: { urlFilter?: string; blueprintId?: string }
): HarCompilationResult {
  const entries = har?.log?.entries ?? [];
  const candidates: Array<{
    candidate: HarCandidateEndpoint;
    entry: HarEntry;
    parsedJson: unknown;
    sampleItem?: Record<string, unknown>;
  }> = [];

  entries.forEach((entry, index) => {
    const reqUrl = entry.request?.url ?? '';
    const method = (entry.request?.method ?? 'GET').toUpperCase();
    const status = entry.response?.status ?? 0;
    const mimeType = entry.response?.content?.mimeType ?? '';
    const bodyText = entry.response?.content?.text ?? '';

    if (!reqUrl || status < 200 || status >= 300) return;
    if (method === 'OPTIONS' || method === 'HEAD') return;
    if (IGNORED_EXTENSIONS.test(reqUrl) || IGNORED_DOMAINS.test(reqUrl)) return;
    if (options?.urlFilter && !reqUrl.toLowerCase().includes(options.urlFilter.toLowerCase())) {
      return;
    }

    const looksLikeJson =
      mimeType.includes('json') ||
      bodyText.trim().startsWith('{') ||
      bodyText.trim().startsWith('[');
    if (!looksLikeJson || !bodyText.trim()) return;

    try {
      const parsedJson = JSON.parse(bodyText);
      const { rootPath, isArray, sampleItem, count } = detectBestJsonRoot(parsedJson);
      let score = 10;
      if (reqUrl.includes('/api/') || reqUrl.includes('/v1/') || reqUrl.includes('/v2/') || reqUrl.includes('graphql')) {
        score += 30;
      }
      if (isArray) score += 25 + Math.min(count, 20);
      if (sampleItem && Object.keys(sampleItem).length >= 3) score += 20;

      candidates.push({
        candidate: {
          index,
          method,
          url: reqUrl,
          status,
          mimeType: mimeType || 'application/json',
          score,
          rootPath,
          isArray,
          sampleItemCount: count,
        },
        entry,
        parsedJson,
        sampleItem,
      });
    } catch {
      // Skip non-JSON responses
    }
  });

  if (candidates.length === 0) {
    throw new Error(
      'No valid JSON API responses found in HAR file. Make sure "Save all as HAR with content" was used.'
    );
  }

  candidates.sort((a, b) => b.candidate.score - a.candidate.score);
  const best = candidates[0];
  const urlObj = new URL(best.entry.request.url);

  // Extract query parameters into Blueprint inputs
  const inputs: Record<string, InputParam> = {};
  const querySpec: Record<string, string> = {};

  urlObj.searchParams.forEach((val, key) => {
    const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, '_');
    const isNum = /^-?\d+$/.test(val);
    inputs[cleanKey] = {
      type: isNum ? 'number' : 'string',
      required: false,
      default: isNum ? Number(val) : val,
      description: `Query parameter "${key}"`,
    };
    querySpec[key] = `{{inputs.${cleanKey}}}`;
  });

  // Clean base URL without query string
  const baseUrl = `${urlObj.origin}${urlObj.pathname}`;

  // Inspect headers for custom API headers vs auth/cookie headers
  const customHeaders: Record<string, string> = {};
  const authHeadersDetected: string[] = [];

  for (const h of best.entry.request.headers ?? []) {
    const lower = h.name.toLowerCase();
    if (lower.startsWith(':') || IGNORED_HEADERS.has(lower)) continue;
    if (lower === 'cookie' || lower === 'authorization' || lower.includes('token') || lower.includes('api-key')) {
      authHeadersDetected.push(h.name);
      continue;
    }
    if (lower === 'accept' || lower === 'content-type' || lower.startsWith('x-')) {
      customHeaders[h.name] = h.value;
    }
  }

  // Generate Blueprint ID & Name
  const hostSlug = urlObj.hostname
    .replace(/^(www|api)\./, '')
    .split('.')[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  const pathSegments = urlObj.pathname
    .split('/')
    .filter((s) => s && !/^v\d+$/i.test(s) && s.toLowerCase() !== 'api');
  const endpointSlug =
    (pathSegments.slice(-2).join('-') || 'endpoint')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');

  const id = options?.blueprintId ?? `${hostSlug}/${endpointSlug}`;
  const fields: Record<string, string> = {};

  if (best.sampleItem) {
    for (const k of Object.keys(best.sampleItem).slice(0, 10)) {
      fields[k] = k;
    }
  }

  let requestBody: unknown = undefined;
  if (
    best.entry.request.postData?.text &&
    best.entry.request.method !== 'GET' &&
    best.entry.request.method !== 'HEAD'
  ) {
    try {
      requestBody = JSON.parse(best.entry.request.postData.text);
    } catch {
      requestBody = best.entry.request.postData.text;
    }
  }

  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
  const method = allowedMethods.includes(best.candidate.method as (typeof allowedMethods)[number])
    ? (best.candidate.method as (typeof allowedMethods)[number])
    : 'GET';

  const generatedBlueprint: Blueprint = {
    id,
    name: `${hostSlug.toUpperCase()} ${endpointSlug.replace(/-/g, ' ')}`,
    version: '1.0.0',
    description: `Compiled from HAR capture of ${best.candidate.method} ${baseUrl}`,
    category: 'har-compiled',
    author: 'openact-har-compiler',
    tags: ['har', 'http', hostSlug],
    homepage: urlObj.origin,
    ...(authHeadersDetected.length > 0 ? { vaultProfile: hostSlug } : {}),
    cacheTtlSeconds: 60,
    inputs,
    execution: {
      mode: 'http',
      request: {
        url: baseUrl,
        method,
        ...(Object.keys(customHeaders).length > 0 ? { headers: customHeaders } : {}),
        ...(Object.keys(querySpec).length > 0 ? { query: querySpec } : {}),
        ...(requestBody !== undefined ? { body: requestBody } : {}),
        timeoutMs: 15000,
      },
      http: {
        responseType: 'json',
        ...(best.candidate.rootPath ? { rootPath: best.candidate.rootPath } : {}),
        multiple: best.candidate.isArray,
        ...(best.candidate.isArray ? { limit: 25 } : {}),
        ...(Object.keys(fields).length > 0 ? { fields } : {}),
      },
    },
    output: best.sampleItem
      ? best.candidate.isArray
        ? {
            type: 'array',
            items: {
              type: 'object',
              properties: inferOutputPropertiesFromObject(best.sampleItem),
            },
          }
        : {
            type: 'object',
            properties: inferOutputPropertiesFromObject(best.sampleItem),
          }
      : { type: 'any' },
    tests: [],
  };

  return {
    candidates: candidates.map((c) => c.candidate),
    selectedCandidate: best.candidate,
    authHeadersDetected,
    generatedBlueprint,
    generatedYaml: YAML.stringify(generatedBlueprint, { indent: 2 }),
  };
}
