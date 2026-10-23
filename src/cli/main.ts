#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { compileHarToBlueprint, HarFile } from '../compiler/har-compiler.js';
import { inspectUrlAndGenerateBlueprint } from '../compiler/url-inspector.js';
import { BlueprintExecutor } from '../engine/executor.js';
import { BlueprintRegistry, LoadedBlueprint } from '../registry/loader.js';
import { startHttpServer } from '../server/http-server.js';
import { startMcpStdioServer } from '../server/mcp-server.js';

function parseInputFlags(pairs: string[] = []): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of pairs) {
    const eqIdx = item.indexOf('=');
    if (eqIdx === -1) continue;
    const key = item.slice(0, eqIdx).trim();
    const val = item.slice(eqIdx + 1).trim();
    result[key] = val;
  }
  return result;
}

export async function runBlueprintTests(
  loadedList: LoadedBlueprint[],
  executor: BlueprintExecutor,
  options?: { live?: boolean }
): Promise<{ passed: number; failed: number; failures: string[] }> {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const loaded of loadedList) {
    const { blueprint } = loaded;
    for (const testCase of blueprint.tests) {
      const label = `${blueprint.id} -> "${testCase.name}"`;
      try {
        const res = await executor.execute(loaded, {
          inputs: testCase.inputs ?? {},
          bypassCache: true,
          mockResponse: options?.live ? undefined : testCase.mockResponse,
        });

        if (!res.meta.validation.valid) {
          throw new Error(
            `Output schema validation failed: ${res.meta.validation.errors.join(', ')}`
          );
        }

        const { expect } = testCase;
        const data = res.data;

        if (expect.minItems !== undefined) {
          if (!Array.isArray(data) || data.length < expect.minItems) {
            throw new Error(
              `Expected at least ${expect.minItems} items, got ${Array.isArray(data) ? data.length : typeof data}`
            );
          }
        }

        if (expect.maxItems !== undefined) {
          if (!Array.isArray(data) || data.length > expect.maxItems) {
            throw new Error(
              `Expected at most ${expect.maxItems} items, got ${Array.isArray(data) ? data.length : typeof data}`
            );
          }
        }

        if (expect.hasKeys && expect.hasKeys.length > 0) {
          const sample = Array.isArray(data) ? data[0] : data;
          if (!sample || typeof sample !== 'object') {
            throw new Error(`Expected object with keys [${expect.hasKeys.join(', ')}], got ${typeof sample}`);
          }
          for (const reqKey of expect.hasKeys) {
            if (!(reqKey in (sample as Record<string, unknown>))) {
              throw new Error(`Missing expected key "${reqKey}" in output`);
            }
          }
        }

        if (expect.notEmpty) {
          if (
            data === null ||
            data === undefined ||
            data === '' ||
            (Array.isArray(data) && data.length === 0)
          ) {
            throw new Error('Expected non-empty output');
          }
        }

        passed++;
      } catch (err) {
        failed++;
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  }

  return { passed, failed, failures };
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  const registry = new BlueprintRegistry();
  const executor = new BlueprintExecutor();

  program
    .name('openact')
    .description(
      'The yt-dlp for turning any website or portal into a deterministic REST API, CLI command, and MCP tool.'
    )
    .version('0.1.0');

  // 1. openact list
  program
    .command('list')
    .description('List all available blueprints in the registry')
    .option('-c, --category <category>', 'Filter by category')
    .option('-s, --search <query>', 'Search blueprints by keyword')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await registry.loadAll();
      const items = registry.list({ category: opts.category, search: opts.search });
      if (opts.json) {
        console.log(
          JSON.stringify(
            items.map((i) => i.blueprint),
            null,
            2
          )
        );
        return;
      }
      console.log(`\nLoaded ${items.length} OpenAct Blueprints:\n`);
      for (const { blueprint, hookPath } of items) {
        const tier = blueprint.execution.mode.toUpperCase().padEnd(7);
        const extras = [
          blueprint.execution.fallback ? '+fallback' : '',
          hookPath ? '+hook' : '',
        ]
          .filter(Boolean)
          .join(' ');
        console.log(
          `  • ${blueprint.id.padEnd(30)} [${tier}] ${blueprint.name} ${extras ? `(${extras})` : ''}`
        );
      }
      console.log('');
    });

  // 2. openact info <id>
  program
    .command('info <id>')
    .description('Show detailed inputs, execution strategy, and output schema for a blueprint')
    .action(async (id: string) => {
      await registry.loadAll();
      const loaded = registry.get(id);
      if (!loaded) {
        console.error(`Blueprint "${id}" not found.`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(loaded.blueprint, null, 2));
    });

  // 3. openact run <id>
  program
    .command('run <id>')
    .description('Execute a blueprint deterministically')
    .option(
      '-i, --input <key=value...>',
      'Input parameter key=value pairs',
      (val: string, prev: string[]) => [...prev, val],
      []
    )
    .option('--no-cache', 'Bypass response cache')
    .option('--profile <vaultProfile>', 'Override Session Vault profile')
    .option('--data-only', 'Output only the extracted data payload without metadata wrapper')
    .action(async (id: string, opts) => {
      await registry.loadAll();
      const loaded = registry.get(id);
      if (!loaded) {
        console.error(`Blueprint "${id}" not found.`);
        process.exitCode = 1;
        return;
      }
      const inputs = parseInputFlags(opts.input);
      const result = await executor.execute(loaded, {
        inputs,
        bypassCache: opts.cache === false,
        vaultProfileOverride: opts.profile,
      });

      if (opts.dataOnly) {
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    });

  // 4. openact validate
  program
    .command('validate')
    .description('Validate all .act.yaml blueprint files in the registry')
    .action(async () => {
      const loaded = await registry.loadAll();
      console.log(`✅ Validated ${loaded.length} blueprints successfully.`);
    });

  // 5. openact test [id]
  program
    .command('test [id]')
    .description('Run embedded blueprint verification tests (offline fixtures by default, or --live)')
    .option('--live', 'Execute tests against live remote websites instead of mock fixtures')
    .action(async (id: string | undefined, opts) => {
      const all = await registry.loadAll();
      const target = id ? all.filter((b) => b.blueprint.id === id) : all;
      if (target.length === 0) {
        console.error(`No matching blueprints found for "${id ?? '*'}".`);
        process.exitCode = 1;
        return;
      }

      const summary = await runBlueprintTests(target, executor, {
        live: Boolean(opts.live),
      });

      console.log(
        `\nBlueprint Test Results (${opts.live ? 'LIVE' : 'FIXTURE'}): ${summary.passed} passed, ${summary.failed} failed.`
      );
      if (summary.failures.length > 0) {
        for (const f of summary.failures) {
          console.error(`  ❌ ${f}`);
        }
        process.exitCode = 1;
      }
    });

  // 6. openact inspect <url>
  program
    .command('inspect <url>')
    .description(
      'Inspect a URL for JSON, Hydration state, JSON-LD, OpenGraph, and repeating DOM structures, and generate a Blueprint'
    )
    .option('-s, --save', 'Save the generated blueprint directly into blueprints/')
    .action(async (url: string, opts) => {
      const report = await inspectUrlAndGenerateBlueprint(url);
      console.log(
        `# Inspection Report for ${url}\n` +
          `# Recommended Tier: ${report.recommendedTier.toUpperCase()} (strategy: ${report.recommendedStrategy})\n` +
          `# Repeatable DOM Candidates: ${report.repeatableDomCandidates.length}, JSON-LD Blocks: ${report.jsonLdCount}\n`
      );
      console.log(report.generatedYaml);

      if (opts.save) {
        const savedPath = registry.saveBlueprintYaml(report.generatedBlueprint);
        console.log(`\n💾 Saved blueprint to ${savedPath}`);
      }
    });

  // 7. openact import-har <harFile>
  program
    .command('import-har <harFile>')
    .description('Compile a browser HAR capture into a Tier-1 HTTP Blueprint')
    .option('-f, --filter <substring>', 'Filter HAR requests by URL substring')
    .option('--id <blueprintId>', 'Custom blueprint ID (namespace/name)')
    .option('-s, --save', 'Save the compiled blueprint into blueprints/')
    .action(async (harFile: string, opts) => {
      const absPath = path.resolve(harFile);
      const rawHar = JSON.parse(fs.readFileSync(absPath, 'utf8')) as HarFile;
      const result = compileHarToBlueprint(rawHar, {
        urlFilter: opts.filter,
        blueprintId: opts.id,
      });

      console.log(
        `# Compiled HAR (${result.candidates.length} JSON endpoints analyzed, top score: ${result.selectedCandidate.score})\n`
      );
      console.log(result.generatedYaml);

      if (opts.save) {
        const savedPath = registry.saveBlueprintYaml(result.generatedBlueprint);
        console.log(`\n💾 Saved compiled blueprint to ${savedPath}`);
      }
    });

  // 8. openact vault
  const vaultCmd = program
    .command('vault')
    .description('Manage local AES-256-GCM encrypted Session Vault profiles');

  vaultCmd
    .command('list')
    .description('List all saved vault profiles')
    .action(() => {
      const profiles = executor.getVault().listProfiles();
      console.log(JSON.stringify(profiles, null, 2));
    });

  vaultCmd
    .command('set <profile>')
    .description('Set headers, cookies, or secrets in a vault profile')
    .option('--domain <domain>', 'Associated domain')
    .option(
      '--header <key=value...>',
      'Header key=value',
      (v: string, p: string[]) => [...p, v],
      []
    )
    .option(
      '--cookie <key=value...>',
      'Cookie key=value',
      (v: string, p: string[]) => [...p, v],
      []
    )
    .option(
      '--secret <key=value...>',
      'Secret key=value (for {{vault.key}})',
      (v: string, p: string[]) => [...p, v],
      []
    )
    .action((profileName: string, opts) => {
      const headers = parseInputFlags(opts.header) as Record<string, string>;
      const cookies = parseInputFlags(opts.cookie) as Record<string, string>;
      const secrets = parseInputFlags(opts.secret) as Record<string, string>;
      const saved = executor.getVault().upsertProfile(profileName, {
        domain: opts.domain,
        headers,
        cookies,
        secrets,
      });
      console.log(`🔒 Updated encrypted vault profile "${saved.name}".`);
    });

  // 9. openact serve
  program
    .command('serve')
    .description('Start the OpenAct REST API, OpenAPI 3.1 server, and Web Studio UI')
    .option('-p, --port <port>', 'Port number', '4100')
    .action(async (opts) => {
      const port = Number(opts.port) || 4100;
      const serverInfo = await startHttpServer(registry, executor, port);
      console.log(`\n🚀 OpenAct Server & Web Studio running!`);
      console.log(`   • Web Studio UI:    http://localhost:${serverInfo.port}`);
      console.log(`   • REST API Base:    http://localhost:${serverInfo.port}/api/v1/blueprints`);
      console.log(`   • OpenAPI 3.1 Spec: http://localhost:${serverInfo.port}/api/v1/openapi.json\n`);
    });

  // 10. openact mcp
  program
    .command('mcp')
    .description('Start the Model Context Protocol (MCP) stdio server for AI agents')
    .action(async () => {
      await startMcpStdioServer(registry, executor);
    });

  await program.parseAsync(argv);
}

// Run CLI when invoked directly
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('/cli/main.ts') ||
    process.argv[1].endsWith('/cli/main.js') ||
    process.argv[1].endsWith('openact'));

if (isDirectExecution) {
  runCli().catch((err) => {
    console.error(`Fatal error: ${(err as Error).message}`);
    process.exit(1);
  });
}
