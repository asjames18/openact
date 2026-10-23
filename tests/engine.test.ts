import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Blueprint,
  BlueprintExecutor,
  CacheAndRateLimiter,
  SessionVault,
  applyTransforms,
  extractFromHtml,
  getByPath,
  interpolateTemplate,
} from '../src/index.js';

describe('OpenAct Core Engine, Transforms, Vault & Cache', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openact-test-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('interpolates inputs, vault secrets, and helper functions cleanly', () => {
    const out = interpolateTemplate(
      'https://api.example.com/search?q={{urlencode inputs.query}}&lang={{uppercase inputs.lang}}&key={{vault.apiKey}}',
      {
        inputs: { query: 'open source & tools', lang: 'en' },
        vault: { apiKey: 'sec_99' },
      }
    );
    expect(out).toBe(
      'https://api.example.com/search?q=open%20source%20%26%20tools&lang=EN&key=sec_99'
    );
  });

  it('evaluates nested paths and array mappings via getByPath', () => {
    const payload = {
      data: {
        children: [
          { data: { title: 'First', score: 10 } },
          { data: { title: 'Second', score: 20 } },
        ],
      },
    };
    expect(getByPath(payload, 'data.children[1].data.title')).toBe('Second');
    expect(getByPath(payload, 'data.children[].data.title')).toEqual([
      'First',
      'Second',
    ]);
  });

  it('applies declarative transform pipelines including shorthand numbers (12.4k)', () => {
    expect(applyTransforms('  /openact/openact  ', ['trim', 'stripLeadingSlash'])).toBe(
      'openact/openact'
    );
    expect(applyTransforms('  12.4k stars today ', ['trim', 'extractNumber'])).toBe(
      12400
    );
    expect(
      applyTransforms('/item/42', [{ prefix: 'https://example.com' }])
    ).toBe('https://example.com/item/42');
  });

  it('extracts Hydration (__NEXT_DATA__) and JSON-LD (Schema.org) in Tier 2', () => {
    const nextHtml = `
      <html>
        <head>
          <script id="__NEXT_DATA__" type="application/json">
            {"props":{"pageProps":{"products":[{"name":"Laptop","price":999},{"name":"Mouse","price":49}]}}}
          </script>
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Product","name":"Pro Keyboard","offers":{"price":"129.00"}}
          </script>
        </head>
        <body></body>
      </html>
    `;

    const hydrated = extractFromHtml(nextHtml, {
      strategy: 'hydration',
      rootPath: 'props.pageProps.products',
      multiple: true,
      fields: {
        productName: 'name',
        cost: 'price',
      },
    });
    expect(hydrated).toEqual([
      { productName: 'Laptop', cost: 999 },
      { productName: 'Mouse', cost: 49 },
    ]);

    const jsonLd = extractFromHtml(nextHtml, {
      strategy: 'json-ld',
      multiple: false,
      fields: {
        type: '@type',
        title: 'name',
        price: { path: 'offers.price', transform: ['extractFloat'] },
      },
    });
    expect(jsonLd).toEqual({
      type: 'Product',
      title: 'Pro Keyboard',
      price: 129,
    });
  });

  it('automatically cascades from Tier 1 (http) to Tier 2 (extract) fallback when primary fails', async () => {
    const dir = makeTempDir();
    const executor = new BlueprintExecutor({
      cache: new CacheAndRateLimiter(dir),
      vault: new SessionVault(dir),
    });

    const bp: Blueprint = {
      id: 'test/fallback-cascade',
      name: 'Fallback Cascade Test',
      version: '1.0.0',
      description: 'Tests fallback from broken HTTP endpoint to HTML extraction',
      category: 'test',
      author: 'test',
      tags: [],
      cacheTtlSeconds: 60,
      inputs: {},
      execution: {
        mode: 'http',
        // Missing request spec without mockResponse forces primary failure if mock not used,
        // or we provide invalid JSON string as mockResponse so Tier 1 JSON parse throws and triggers Tier 2 HTML fallback!
        http: {
          responseType: 'json',
          multiple: false,
        },
        fallback: {
          mode: 'extract',
          extract: {
            strategy: 'css',
            root: 'div.card',
            multiple: false,
            fields: {
              heading: 'h1',
            },
          },
        },
      },
      tests: [],
    };

    const res = await executor.execute(bp, {
      mockResponse: '<div class="card"><h1>Recovered via Tier 2 Fallback</h1></div>',
    });

    expect(res.meta.fallbackUsed).toBe(true);
    expect(res.meta.tierUsed).toBe('extract');
    expect(res.data).toEqual({ heading: 'Recovered via Tier 2 Fallback' });
  });

  it('encrypts and decrypts Session Vault profiles with AES-256-GCM', () => {
    const dir = makeTempDir();
    const vault = new SessionVault(dir);

    vault.upsertProfile('portal', {
      domain: 'portal.example.com',
      headers: { 'X-Custom-Auth': 'token-xyz' },
      cookies: { session_id: 'abc12345' },
      secrets: { apiSecret: 'top-secret-val' },
    });

    const vaultReloaded = new SessionVault(dir);
    const headers = vaultReloaded.getRequestHeaders('portal');
    expect(headers['X-Custom-Auth']).toBe('token-xyz');
    expect(headers.Cookie).toBe('session_id=abc12345');
    expect(vaultReloaded.getMergedSecrets('portal')).toEqual({
      apiSecret: 'top-secret-val',
    });
  });
});
