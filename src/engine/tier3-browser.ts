import {
  BrowserExecutionSpec,
  RequestSpec,
} from '../schema/blueprint.js';
import { TemplateContext, interpolateTemplate } from './template.js';
import { DEFAULT_USER_AGENT, mapHttpPayload } from './tier1-http.js';
import { extractFromHtml } from './tier2-extract.js';

/**
 * Tier 3 Executor: Playwright Browser Automation & Live XHR/Fetch Network Interceptor.
 */
export async function executeTier3Browser(options: {
  requestSpec?: RequestSpec;
  browserSpec?: BrowserExecutionSpec;
  ctx: TemplateContext;
  vaultHeaders?: Record<string, string>;
  storageState?: Record<string, unknown>;
  mockResponse?: unknown;
}): Promise<unknown> {
  const {
    requestSpec,
    browserSpec,
    ctx,
    vaultHeaders = {},
    storageState,
    mockResponse,
  } = options;

  // Support fast offline fixture testing when mockResponse is supplied
  if (mockResponse !== undefined) {
    if (browserSpec?.http) {
      const parsed =
        typeof mockResponse === 'string' ? JSON.parse(mockResponse) : mockResponse;
      return mapHttpPayload(parsed, browserSpec.http);
    }
    const html =
      typeof mockResponse === 'string' ? mockResponse : JSON.stringify(mockResponse);
    return extractFromHtml(
      html,
      browserSpec?.extract ?? { strategy: 'auto', multiple: false }
    );
  }

  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: browserSpec?.headless ?? true,
  });

  try {
    const contextOptions: Record<string, unknown> = {
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: vaultHeaders,
    };
    if (storageState) {
      contextOptions.storageState = storageState;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    const interceptedPayloads: unknown[] = [];
    const interceptPattern = browserSpec?.interceptUrlPattern
      ? interpolateTemplate(browserSpec.interceptUrlPattern, ctx)
      : null;

    if (interceptPattern) {
      page.on('response', async (response) => {
        try {
          const url = response.url();
          if (
            url.includes(interceptPattern) ||
            new RegExp(interceptPattern).test(url)
          ) {
            const ct = response.headers()['content-type'] ?? '';
            if (ct.includes('json')) {
              const json = await response.json();
              interceptedPayloads.push(json);
            }
          }
        } catch {
          // Ignore non-JSON or aborted responses
        }
      });
    }

    // Navigate if request.url is specified
    if (requestSpec?.url) {
      const targetUrl = interpolateTemplate(requestSpec.url, ctx);
      await page.goto(targetUrl, {
        waitUntil: browserSpec?.waitUntil ?? 'domcontentloaded',
        timeout: requestSpec.timeoutMs ?? 25000,
      });
    }

    // Run deterministic steps
    if (browserSpec?.steps) {
      for (const step of browserSpec.steps) {
        switch (step.action) {
          case 'goto': {
            const url = interpolateTemplate(step.url, ctx);
            await page.goto(url, {
              waitUntil: step.waitUntil ?? browserSpec.waitUntil ?? 'domcontentloaded',
            });
            break;
          }
          case 'click': {
            const selector = interpolateTemplate(step.selector, ctx);
            await page.click(selector, { timeout: step.timeoutMs ?? 10000 });
            break;
          }
          case 'fill': {
            const selector = interpolateTemplate(step.selector, ctx);
            const value = interpolateTemplate(step.value, ctx);
            await page.fill(selector, value);
            break;
          }
          case 'press': {
            const selector = interpolateTemplate(step.selector, ctx);
            await page.press(selector, step.key);
            break;
          }
          case 'waitForSelector': {
            const selector = interpolateTemplate(step.selector, ctx);
            await page.waitForSelector(selector, { timeout: step.timeoutMs ?? 10000 });
            break;
          }
          case 'waitMs': {
            await page.waitForTimeout(step.ms);
            break;
          }
          case 'evaluate': {
            const expr = interpolateTemplate(step.expression, ctx);
            const evalResult = await page.evaluate(expr);
            if (!browserSpec.extract && !browserSpec.http && browserSpec.steps.length === 1) {
              return evalResult;
            }
            break;
          }
        }
      }
    }

    // If interceptUrlPattern captured JSON payloads and http mapping is configured
    if (interceptPattern && interceptedPayloads.length > 0) {
      const payload =
        interceptedPayloads.length === 1
          ? interceptedPayloads[0]
          : interceptedPayloads[interceptedPayloads.length - 1];
      return mapHttpPayload(payload, browserSpec?.http);
    }

    const renderedHtml = await page.content();
    return extractFromHtml(
      renderedHtml,
      browserSpec?.extract ?? { strategy: 'auto', multiple: false }
    );
  } finally {
    await browser.close();
  }
}
