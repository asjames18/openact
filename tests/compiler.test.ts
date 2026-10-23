import { describe, expect, it } from 'vitest';
import {
  compileHarToBlueprint,
  HarFile,
  inspectUrlAndGenerateBlueprint,
} from '../src/index.js';

describe('OpenAct URL Inspector & HAR-to-Blueprint Compiler', () => {
  it('inspects HTML with repeating DOM structures and generates a valid CSS Blueprint', async () => {
    const sampleHtml = `
      <html>
        <head><title>News Board</title></head>
        <body>
          <main>
            <article class="post-card">
              <h2><a href="/posts/1">OpenAct 0.1 Released</a></h2>
              <p>Deterministic web-to-API platform for open source.</p>
            </article>
            <article class="post-card">
              <h2><a href="/posts/2">Why Local-First Wins</a></h2>
              <p>Zero cloud lock-in and instant execution.</p>
            </article>
            <article class="post-card">
              <h2><a href="/posts/3">Community Blueprints</a></h2>
              <p>How contributors share 50-line YAML files.</p>
            </article>
          </main>
        </body>
      </html>
    `;

    const report = await inspectUrlAndGenerateBlueprint(
      'https://news.example.com/latest',
      { rawBody: sampleHtml, contentType: 'text/html' }
    );

    expect(report.recommendedTier).toBe('extract');
    expect(report.recommendedStrategy).toBe('css');
    expect(report.repeatableDomCandidates.length).toBeGreaterThan(0);
    expect(report.repeatableDomCandidates[0].rootSelector).toBe('article.post-card');
    expect(report.generatedBlueprint.id).toBe('news/latest');
    expect(report.generatedYaml).toContain('article.post-card');
  });

  it('compiles a browser HAR file into a Tier-1 HTTP Blueprint with inferred inputs and schema', () => {
    const sampleHar: HarFile = {
      log: {
        entries: [
          {
            request: {
              method: 'GET',
              url: 'https://cdn.example.com/bundle.js',
            },
            response: {
              status: 200,
              content: { mimeType: 'application/javascript', text: 'console.log(1)' },
            },
          },
          {
            request: {
              method: 'GET',
              url: 'https://api.acme.com/v1/orders?status=shipped&limit=20',
              headers: [
                { name: 'Accept', value: 'application/json' },
                { name: 'Authorization', value: 'Bearer secret_jwt' },
                { name: 'X-Acme-Client', value: 'web-dashboard' },
              ],
            },
            response: {
              status: 200,
              content: {
                mimeType: 'application/json',
                text: JSON.stringify({
                  data: {
                    orders: [
                      {
                        orderId: 'ORD-100',
                        totalUsd: 149.99,
                        express: true,
                      },
                    ],
                  },
                }),
              },
            },
          },
        ],
      },
    };

    const compiled = compileHarToBlueprint(sampleHar);

    expect(compiled.candidates.length).toBe(1);
    expect(compiled.selectedCandidate.rootPath).toBe('data.orders');
    expect(compiled.authHeadersDetected).toContain('Authorization');
    expect(compiled.generatedBlueprint.id).toBe('acme/orders');
    expect(compiled.generatedBlueprint.vaultProfile).toBe('acme');
    expect(compiled.generatedBlueprint.inputs.status.default).toBe('shipped');
    expect(compiled.generatedBlueprint.inputs.limit.type).toBe('number');
    expect(compiled.generatedBlueprint.execution.mode).toBe('http');
  });
});
