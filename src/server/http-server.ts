import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import YAML from 'yaml';
import { compileHarToBlueprint, HarFile } from '../compiler/har-compiler.js';
import { inspectUrlAndGenerateBlueprint } from '../compiler/url-inspector.js';
import { BlueprintExecutor } from '../engine/executor.js';
import { BlueprintRegistry, LoadedBlueprint } from '../registry/loader.js';
import { BlueprintSchema } from '../schema/blueprint.js';
import { getStudioHtml } from '../studio/ui-html.js';

/**
 * Generates an OpenAPI 3.1.0 specification dynamically from all loaded blueprints.
 */
export function buildOpenApiSpec(
  blueprints: LoadedBlueprint[],
  baseUrl: string = 'http://localhost:4100'
) {
  const paths: Record<string, unknown> = {};

  for (const { blueprint } of blueprints) {
    const routePath = `/api/v1/run/${blueprint.id}`;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [k, param] of Object.entries(blueprint.inputs)) {
      properties[k] = {
        type: param.type,
        description: param.description,
        ...(param.default !== undefined ? { default: param.default } : {}),
        ...(param.enum ? { enum: param.enum } : {}),
      };
      if (param.required) {
        required.push(k);
      }
    }

    paths[routePath] = {
      post: {
        operationId: `run_${blueprint.id.replace(/\//g, '_')}`,
        summary: blueprint.name,
        description: blueprint.description,
        tags: [blueprint.category],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  inputs: {
                    type: 'object',
                    properties,
                    ...(required.length > 0 ? { required } : {}),
                  },
                  bypassCache: {
                    type: 'boolean',
                    default: false,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Deterministic execution result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    blueprintId: { type: 'string' },
                    inputs: { type: 'object' },
                    data: blueprint.output ?? { type: 'object' },
                    meta: {
                      type: 'object',
                      properties: {
                        tierUsed: { type: 'string' },
                        cached: { type: 'boolean' },
                        durationMs: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'OpenAct Deterministic Web-to-API Server',
      version: '0.1.0',
      description:
        'Auto-generated OpenAPI 3.1 specification for all installed OpenAct community blueprints.',
    },
    servers: [{ url: baseUrl }],
    paths,
  };
}

/**
 * Creates the Hono application instance for OpenAct REST API & Web Studio UI.
 */
export function createOpenActApp(
  registry: BlueprintRegistry,
  executor: BlueprintExecutor
): Hono {
  const app = new Hono();

  // Studio Web UI
  app.get('/', (c) => c.html(getStudioHtml()));

  // Healthcheck
  app.get('/api/v1/health', (c) =>
    c.json({
      status: 'ok',
      version: '0.1.0',
      blueprintsLoaded: registry.list().length,
    })
  );

  // OpenAPI 3.1 Specification
  app.get('/api/v1/openapi.json', (c) => {
    const host = c.req.header('host') ?? 'localhost:4100';
    const spec = buildOpenApiSpec(registry.list(), `http://${host}`);
    return c.json(spec);
  });

  // List Blueprints
  app.get('/api/v1/blueprints', (c) => {
    const category = c.req.query('category');
    const search = c.req.query('search');
    const items = registry.list({ category, search }).map((b) => ({
      id: b.blueprint.id,
      name: b.blueprint.name,
      version: b.blueprint.version,
      description: b.blueprint.description,
      category: b.blueprint.category,
      tags: b.blueprint.tags,
      mode: b.blueprint.execution.mode,
      hasFallback: Boolean(b.blueprint.execution.fallback),
      hasHook: Boolean(b.hookPath),
      inputs: b.blueprint.inputs,
    }));
    return c.json({ count: items.length, blueprints: items });
  });

  // Get Single Blueprint Details
  app.get('/api/v1/blueprints/:namespace/:name', (c) => {
    const id = `${c.req.param('namespace')}/${c.req.param('name')}`;
    const loaded = registry.get(id);
    if (!loaded) {
      return c.json({ error: `Blueprint "${id}" not found` }, 404);
    }
    const yaml = fs.existsSync(loaded.filePath)
      ? fs.readFileSync(loaded.filePath, 'utf8')
      : YAML.stringify(loaded.blueprint, { indent: 2 });

    return c.json({
      blueprint: loaded.blueprint,
      filePath: loaded.filePath,
      hasHook: Boolean(loaded.hookPath),
      yaml,
    });
  });

  // Save/Register a Blueprint from YAML or JSON
  app.post('/api/v1/blueprints', async (c) => {
    try {
      const body = await c.req.json<{ yaml?: string; blueprint?: unknown }>();
      const rawObj = body.yaml ? YAML.parse(body.yaml) : body.blueprint;
      const parsed = BlueprintSchema.parse(rawObj);
      const savedPath = registry.saveBlueprintYaml(parsed);
      return c.json({ blueprint: parsed, filePath: savedPath }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Execute Blueprint via GET (query params as inputs)
  app.get('/api/v1/run/:namespace/:name', async (c) => {
    const id = `${c.req.param('namespace')}/${c.req.param('name')}`;
    const loaded = registry.get(id);
    if (!loaded) {
      return c.json({ error: `Blueprint "${id}" not found` }, 404);
    }
    try {
      const queryInputs = c.req.query();
      const bypassCache = queryInputs._bypassCache === 'true';
      delete queryInputs._bypassCache;
      const result = await executor.execute(loaded, {
        inputs: queryInputs,
        bypassCache,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message, blueprintId: id }, 400);
    }
  });

  // Execute Blueprint via POST
  app.post('/api/v1/run/:namespace/:name', async (c) => {
    const id = `${c.req.param('namespace')}/${c.req.param('name')}`;
    const loaded = registry.get(id);
    if (!loaded) {
      return c.json({ error: `Blueprint "${id}" not found` }, 404);
    }
    try {
      const body = await c.req
        .json<{
          inputs?: Record<string, unknown>;
          bypassCache?: boolean;
          vaultProfile?: string;
        }>()
        .catch(
          (): {
            inputs?: Record<string, unknown>;
            bypassCache?: boolean;
            vaultProfile?: string;
          } => ({})
        );
      const result = await executor.execute(loaded, {
        inputs: body.inputs ?? {},
        bypassCache: Boolean(body.bypassCache),
        vaultProfileOverride: body.vaultProfile,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message, blueprintId: id }, 400);
    }
  });

  // URL Inspector endpoint
  app.post('/api/v1/inspect', async (c) => {
    try {
      const body = await c.req.json<{ url: string; rawBody?: string }>();
      if (!body.url) {
        return c.json({ error: '`url` is required' }, 400);
      }
      const report = await inspectUrlAndGenerateBlueprint(body.url, {
        rawBody: body.rawBody,
      });
      return c.json(report);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // HAR Compiler endpoint
  app.post('/api/v1/compile-har', async (c) => {
    try {
      const body = await c.req.json<{
        har: HarFile;
        urlFilter?: string;
        blueprintId?: string;
      }>();
      const compiled = compileHarToBlueprint(body.har, {
        urlFilter: body.urlFilter,
        blueprintId: body.blueprintId,
      });
      return c.json(compiled);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Session Vault endpoints
  app.get('/api/v1/vault/profiles', (c) => {
    const profiles = executor.getVault().listProfiles();
    return c.json({ profiles });
  });

  app.post('/api/v1/vault/profiles', async (c) => {
    try {
      const body = await c.req.json<{
        name: string;
        domain?: string;
        headers?: Record<string, string>;
        cookies?: Record<string, string>;
        secrets?: Record<string, string>;
      }>();
      if (!body.name) {
        return c.json({ error: 'Profile `name` is required' }, 400);
      }
      const profile = executor.getVault().upsertProfile(body.name, body);
      return c.json({
        name: profile.name,
        domain: profile.domain,
        updatedAt: profile.updatedAt,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.delete('/api/v1/vault/profiles/:name', (c) => {
    const deleted = executor.getVault().deleteProfile(c.req.param('name'));
    return c.json({ deleted });
  });

  // Cache Clear endpoint
  app.post('/api/v1/cache/clear', (c) => {
    const cleared = executor.getCache().clearCache();
    return c.json({ cleared });
  });

  return app;
}

/**
 * Starts the HTTP Server and Web Studio UI.
 */
export async function startHttpServer(
  registry: BlueprintRegistry,
  executor: BlueprintExecutor,
  port: number = 4100
): Promise<{ close: () => void; port: number }> {
  await registry.loadAll();
  const app = createOpenActApp(registry, executor);

  return new Promise((resolve) => {
    const server = serve(
      {
        fetch: app.fetch,
        port,
      },
      (info) => {
        resolve({
          port: info.port,
          close: () => server.close(),
        });
      }
    );
  });
}
