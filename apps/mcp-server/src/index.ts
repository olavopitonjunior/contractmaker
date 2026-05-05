#!/usr/bin/env node
/**
 * Contractmaker MCP Server
 *
 * Bridge entre Claude Desktop / GPTs / n8n e a API REST do Contractmaker.
 *
 * Cada tool MCP corresponde a um endpoint REST com Bearer auth. Tokens
 * gerados em https://imobpro.ia.br/settings/api-tokens.
 *
 * Configuração (ex. Claude Desktop):
 *   {
 *     "mcpServers": {
 *       "contractmaker": {
 *         "command": "node",
 *         "args": ["/path/to/apps/mcp-server/dist/index.js"],
 *         "env": {
 *           "CONTRACTMAKER_API_URL": "https://imobpro.ia.br",
 *           "CONTRACTMAKER_API_TOKEN": "cmt_..."
 *         }
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, type ToolHandler } from "./tools.js";

const API_URL =
  process.env.CONTRACTMAKER_API_URL ?? "https://imobpro.ia.br";
const API_TOKEN = process.env.CONTRACTMAKER_API_TOKEN;

if (!API_TOKEN) {
  console.error("ERROR: CONTRACTMAKER_API_TOKEN não definido em env");
  process.exit(1);
}

export async function callApi(args: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<{ status: number; body: unknown }> {
  const url = new URL(args.path, API_URL);
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_TOKEN}`,
    Accept: "application/json",
  };
  if (args.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (args.idempotencyKey) {
    headers["X-Idempotency-Key"] = args.idempotencyKey;
  }
  const res = await fetch(url, {
    method: args.method,
    headers,
    body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

const server = new Server(
  {
    name: "contractmaker-mcp",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Tool ${request.params.name} não existe` }],
      isError: true,
    };
  }

  try {
    const handler = tool.handler as ToolHandler;
    const result = await handler(request.params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Erro: ${msg}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[contractmaker-mcp] connected to ${API_URL} (${tools.length} tools)`
  );
}

main().catch((err) => {
  console.error("[contractmaker-mcp] fatal:", err);
  process.exit(1);
});
