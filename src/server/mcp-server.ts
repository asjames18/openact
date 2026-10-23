import readline from 'node:readline';
import { BlueprintExecutor } from '../engine/executor.js';
import { BlueprintRegistry, LoadedBlueprint } from '../registry/loader.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Converts a Blueprint ID (`developer/github-trending`) to an MCP-safe tool name
 * (`openact__developer__github_trending`).
 */
export function blueprintIdToMcpToolName(id: string): string {
  return `openact__${id.replace(/\//g, '__').replace(/-/g, '_')}`;
}

/**
 * Builds the MCP Tool descriptor list for all loaded blueprints.
 */
export function buildMcpToolList(blueprints: LoadedBlueprint[]) {
  return blueprints.map(({ blueprint }) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, param] of Object.entries(blueprint.inputs)) {
      properties[key] = {
        type: param.type,
        description: param.description ?? `Input parameter ${key}`,
        ...(param.enum ? { enum: param.enum } : {}),
        ...(param.default !== undefined ? { default: param.default } : {}),
      };
      if (param.required) {
        required.push(key);
      }
    }

    return {
      name: blueprintIdToMcpToolName(blueprint.id),
      description: `[OpenAct: ${blueprint.id}] ${blueprint.description}`,
      inputSchema: {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };
  });
}

/**
 * Handles a single JSON-RPC 2.0 MCP request object and returns a JSON-RPC response
 * (or null for notifications).
 */
export async function handleMcpJsonRpcRequest(
  req: JsonRpcRequest,
  registry: BlueprintRegistry,
  executor: BlueprintExecutor
): Promise<Record<string, unknown> | null> {
  // Notifications have no `id`
  if (req.id === undefined) {
    return null;
  }

  try {
    if (req.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'openact-mcp-server',
            version: '0.1.0',
          },
          capabilities: {
            tools: {},
          },
        },
      };
    }

    if (req.method === 'ping') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {},
      };
    }

    if (req.method === 'tools/list') {
      const list = registry.list();
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          tools: buildMcpToolList(list),
        },
      };
    }

    if (req.method === 'tools/call') {
      const params = (req.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const toolName = params.name ?? '';
      const all = registry.list();
      const matched = all.find(
        (b) =>
          blueprintIdToMcpToolName(b.blueprint.id) === toolName ||
          b.blueprint.id === toolName
      );

      if (!matched) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32602,
            message: `Unknown OpenAct blueprint tool: "${toolName}"`,
          },
        };
      }

      const execResult = await executor.execute(matched, {
        inputs: params.arguments ?? {},
      });

      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(execResult, null, 2),
            },
          ],
          isError: false,
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      error: {
        code: -32601,
        message: `Method not found: ${req.method}`,
      },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: `Error executing blueprint: ${(err as Error).message}`,
          },
        ],
        isError: true,
      },
    };
  }
}

/**
 * Starts the stdio Model Context Protocol (MCP) server for AI Agents.
 */
export async function startMcpStdioServer(
  registry: BlueprintRegistry,
  executor: BlueprintExecutor
): Promise<void> {
  await registry.loadAll();

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      const res = await handleMcpJsonRpcRequest(req, registry, executor);
      if (res) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
      }
    } catch {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })}\n`
      );
    }
  });
}
