import { describe, expect, it } from 'vitest';
import { runBlueprintTests } from '../src/cli/main.js';
import {
  BlueprintExecutor,
  BlueprintRegistry,
  createOpenActApp,
  handleMcpJsonRpcRequest,
} from '../src/index.js';

describe('OpenAct Starter Blueprint Registry, REST API, OpenAPI 3.1 & MCP Server', () => {
  it('loads and passes all embedded fixture tests across all 10 starter blueprints', async () => {
    const registry = new BlueprintRegistry();
    const executor = new BlueprintExecutor();
    const loaded = await registry.loadAll();

    expect(loaded.length).toBeGreaterThanOrEqual(10);

    const summary = await runBlueprintTests(loaded, executor, { live: false });
    expect(summary.failures).toEqual([]);
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBeGreaterThanOrEqual(10);
  });

  it('serves REST API endpoints and OpenAPI 3.1 specification via Hono app', async () => {
    const registry = new BlueprintRegistry();
    const executor = new BlueprintExecutor();
    await registry.loadAll();

    const app = createOpenActApp(registry, executor);

    const healthRes = await app.request('/api/v1/health');
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('ok');
    expect(healthJson.blueprintsLoaded).toBeGreaterThanOrEqual(10);

    const openApiRes = await app.request('/api/v1/openapi.json');
    expect(openApiRes.status).toBe(200);
    const openApiJson = await openApiRes.json();
    expect(openApiJson.openapi).toBe('3.1.0');
    expect(openApiJson.paths['/api/v1/run/developer/github-trending']).toBeDefined();
  });

  it('exposes all blueprints as MCP tools over JSON-RPC 2.0', async () => {
    const registry = new BlueprintRegistry();
    const executor = new BlueprintExecutor();
    await registry.loadAll();

    const initRes = await handleMcpJsonRpcRequest(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      registry,
      executor
    );
    expect(initRes).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: { name: 'openact-mcp-server' },
      },
    });

    const listRes = (await handleMcpJsonRpcRequest(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      registry,
      executor
    )) as { result: { tools: Array<{ name: string }> } };

    const toolNames = listRes.result.tools.map((t) => t.name);
    expect(toolNames).toContain('openact__developer__github_trending');
    expect(toolNames).toContain('openact__utilities__exchange_rates');
  });
});
