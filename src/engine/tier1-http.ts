import { HttpExecutionSpec, RequestSpec } from '../schema/blueprint.js';
import { TemplateContext, interpolateDeep, interpolateTemplate } from './template.js';
import { extractFieldsFromJson, getByPath } from './transforms.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OpenAct/0.1';

/**
 * Builds the full URL and fetch RequestInit from a RequestSpec + TemplateContext + Vault headers.
 */
export function buildFetchRequest(
  requestSpec: RequestSpec,
  ctx: TemplateContext,
  vaultHeaders: Record<string, string> = {}
): { url: string; init: RequestInit; timeoutMs: number } {
  const rawUrl = interpolateTemplate(requestSpec.url, ctx);
  const urlObj = new URL(rawUrl);

  if (requestSpec.query) {
    for (const [k, v] of Object.entries(requestSpec.query)) {
      const interpolatedVal =
        typeof v === 'string' ? interpolateTemplate(v, ctx) : String(v);
      if (interpolatedVal !== '') {
        urlObj.searchParams.set(k, interpolatedVal);
      }
    }
  }

  const interpolatedSpecHeaders = requestSpec.headers
    ? interpolateDeep(requestSpec.headers, ctx)
    : {};

  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    ...vaultHeaders,
    ...interpolatedSpecHeaders,
  };

  const init: RequestInit = {
    method: requestSpec.method ?? 'GET',
    headers,
  };

  if (
    requestSpec.body !== undefined &&
    requestSpec.method !== 'GET' &&
    requestSpec.method !== 'HEAD'
  ) {
    const interpolatedBody = interpolateDeep(requestSpec.body, ctx);
    if (typeof interpolatedBody === 'string') {
      init.body = interpolatedBody;
    } else {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      init.body = JSON.stringify(interpolatedBody);
    }
  }

  return {
    url: urlObj.toString(),
    init,
    timeoutMs: requestSpec.timeoutMs ?? 15000,
  };
}

/**
 * Performs an HTTP fetch with timeout and returns raw text/JSON.
 */
export async function performHttpFetch(
  requestSpec: RequestSpec,
  ctx: TemplateContext,
  vaultHeaders: Record<string, string> = {}
): Promise<{ status: number; bodyText: string; contentType: string; finalUrl: string }> {
  const { url, init, timeoutMs } = buildFetchRequest(requestSpec, ctx, vaultHeaders);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} from ${url}: ${bodyText.slice(0, 200)}`
      );
    }
    return {
      status: response.status,
      bodyText,
      contentType: response.headers.get('content-type') ?? '',
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Processes a parsed JSON (or text) payload according to HttpExecutionSpec.
 */
export function mapHttpPayload(rawPayload: unknown, spec?: HttpExecutionSpec): unknown {
  if (!spec) return rawPayload;

  const targetNode = spec.rootPath ? getByPath(rawPayload, spec.rootPath) : rawPayload;

  if (spec.multiple) {
    const arr = Array.isArray(targetNode)
      ? targetNode
      : targetNode !== undefined && targetNode !== null
        ? [targetNode]
        : [];
    const sliced = spec.limit ? arr.slice(0, spec.limit) : arr;
    return sliced.map((item) => extractFieldsFromJson(item, spec.fields));
  }

  return extractFieldsFromJson(targetNode, spec.fields);
}

/**
 * Tier 1 Executor: Direct HTTP / REST / GraphQL / XHR Replay.
 */
export async function executeTier1Http(options: {
  requestSpec?: RequestSpec;
  httpSpec?: HttpExecutionSpec;
  ctx: TemplateContext;
  vaultHeaders?: Record<string, string>;
  mockResponse?: unknown;
}): Promise<unknown> {
  const { requestSpec, httpSpec, ctx, vaultHeaders, mockResponse } = options;

  let rawData: unknown;

  if (mockResponse !== undefined) {
    if (typeof mockResponse === 'string' && (httpSpec?.responseType ?? 'json') === 'json') {
      rawData = JSON.parse(mockResponse);
    } else {
      rawData = mockResponse;
    }
  } else {
    if (!requestSpec) {
      throw new Error('Tier 1 (http) execution requires a `request` specification.');
    }
    const { bodyText } = await performHttpFetch(requestSpec, ctx, vaultHeaders);
    if ((httpSpec?.responseType ?? 'json') === 'json') {
      try {
        rawData = JSON.parse(bodyText);
      } catch (err) {
        throw new Error(
          `Failed to parse JSON response from ${requestSpec.url}: ${(err as Error).message}`
        );
      }
    } else {
      rawData = bodyText;
    }
  }

  return mapHttpPayload(rawData, httpSpec);
}
