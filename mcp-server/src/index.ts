import readline from 'node:readline';
import { instancesDomain } from './domains/instances.ts';
import { devServersDomain } from './domains/devServers.ts';
import { compositionDomain } from './domains/composition.ts';
import { diagnosticsDomain } from './domains/diagnostics.ts';
import type { McpToolDefinition, SreToolDomain } from './types/ipc.ts';

/**
 * Extensible Domain Registry for PanoramaSRE MCP Tools.
 * Future non-prod operational domains can be registered here by adding a new `SreToolDomain`.
 */
export const REGISTERED_DOMAINS: SreToolDomain[] = [
  instancesDomain,
  devServersDomain,
  compositionDomain,
  diagnosticsDomain,
];

export function getAllRegisteredTools(): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [];
  for (const domain of REGISTERED_DOMAINS) {
    for (const tool of domain.tools) {
      tools.push(tool);
    }
  }
  return tools;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function sendJsonRpc(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function handleJsonRpcMessage(msg: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  const { id, method, params } = msg;

  // Notifications (no id) require no response
  if (id === undefined) {
    return null;
  }

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'panorama-sre',
              version: '1.0.0',
            },
          },
        };
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };
      }

      case 'tools/list': {
        const tools = getAllRegisteredTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools,
          },
        };
      }

      case 'tools/call': {
        const toolName = String(params?.name || '');
        const toolArgs = (params?.arguments as Record<string, unknown>) || {};
        const tool = getAllRegisteredTools().find((t) => t.name === toolName);

        if (!tool) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Unknown PanoramaSRE MCP tool: '${toolName}'`,
                },
              ],
            },
          };
        }

        try {
          const output = await tool.handler(toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: false,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(output, null, 2),
                },
              ],
            },
          };
        } catch (toolErr) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `PanoramaSRE MCP tool '${toolName}' failed: ${(toolErr as Error).message}`,
                },
              ],
            },
          };
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
      }
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Internal error: ${(err as Error).message}`,
      },
    };
  }
}

export function startMcpStdioServer(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as JsonRpcRequest;
      const response = await handleJsonRpcMessage(parsed);
      if (response) {
        sendJsonRpc(response);
      }
    } catch (err) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${(err as Error).message}`,
        },
      });
    }
  });
}

// Start stdio server when executed directly
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/index.ts')) {
  startMcpStdioServer();
}
