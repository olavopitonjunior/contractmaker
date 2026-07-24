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

// WhatsApp bridge — opcional. Se não configurado, tool whatsapp_send retorna
// erro claro. Permite Newton rodar sem WhatsApp em ambientes dev/staging.
const WPP_BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL;
const WPP_BRIDGE_TOKEN = process.env.WHATSAPP_BRIDGE_TOKEN;

// Sidecar — opcional (F2). Se configurado, cada envio proativo (whatsapp_send)
// é registrado no histórico de conversa do DM do destinatário, pra que uma
// resposta dele a essa mensagem tenha contexto no /run do sidecar. No-op se
// ausente — degrada limpo em dev/staging.
const SIDECAR_URL = process.env.SIDECAR_URL;
const SIDECAR_TOKEN = process.env.SIDECAR_TOKEN;
const SIDECAR_AGENT_ID = process.env.SIDECAR_AGENT_ID ?? "main";

if (!API_TOKEN) {
  console.error("ERROR: CONTRACTMAKER_API_TOKEN não definido em env");
  process.exit(1);
}

export async function callBridge(args: {
  path: string;
  body?: unknown;
}): Promise<{ status: number; body: unknown }> {
  if (!WPP_BRIDGE_URL || !WPP_BRIDGE_TOKEN) {
    return {
      status: 503,
      body: {
        error:
          "WhatsApp bridge não configurado (WHATSAPP_BRIDGE_URL + WHATSAPP_BRIDGE_TOKEN ausentes)",
      },
    };
  }
  const url = new URL(args.path, WPP_BRIDGE_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WPP_BRIDGE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
  });
  const text = await res.text();
  let body: unknown;
  if (text.trim() === "") {
    // F3: upstream devolveu corpo vazio. Não exponha um "" cru — o modelo lê
    // isso como "resultado vazio". Marca explicitamente pra distinguir leitura
    // degradada/vazia de uma lista realmente vazia ou um zero real.
    body = res.ok
      ? { _empty: true, status: res.status, note: "upstream returned empty body" }
      : { _error: true, status: res.status, note: "upstream error with empty body" };
  } else {
    body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
  }
  return { status: res.status, body };
}

export async function callApi(args: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /**
   * Quando setado, injeta header `X-Act-As-User: <userId>`. Backend (atrás de
   * DELEGATION_ENABLED=true) então aplica filtros sales-role contra esse user.
   * Resolvido via tool `resolve_caller(phone)` e propagado pelas demais tools
   * que aceitam este param.
   */
  actAsUserId?: string;
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
  if (args.actAsUserId) {
    headers["X-Act-As-User"] = args.actAsUserId;
  }
  const res = await fetch(url, {
    method: args.method,
    headers,
    body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
  });
  const text = await res.text();
  let body: unknown;
  if (text.trim() === "") {
    // F3: upstream devolveu corpo vazio. Não exponha um "" cru — o modelo lê
    // isso como "resultado vazio". Marca explicitamente pra distinguir leitura
    // degradada/vazia de uma lista realmente vazia ou um zero real.
    body = res.ok
      ? { _empty: true, status: res.status, note: "upstream returned empty body" }
      : { _error: true, status: res.status, note: "upstream error with empty body" };
  } else {
    body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
  }
  return { status: res.status, body };
}

/**
 * F2: registra um envio proativo (whatsapp_send) no histórico de conversa do
 * sidecar, em `dm:<to>`, pra que uma resposta do usuário a essa mensagem
 * proativa (briefing, cutuço, lembrete) tenha contexto no próximo /run.
 *
 * Best-effort: NUNCA quebra o envio (try/catch engole o erro). No-op se
 * SIDECAR_URL/SIDECAR_TOKEN ausentes. `to` segue a convenção E.164 sem '+',
 * idêntica ao caller.phone que o bridge usa pra montar o sessionKey do DM.
 */
export async function logProactiveOutbound(args: {
  to: string;
  content: string;
}): Promise<void> {
  if (!SIDECAR_URL || !SIDECAR_TOKEN) return;
  const phone = String(args.to ?? "").trim();
  if (!phone || !args.content) return;
  try {
    const url = new URL(`/agents/${SIDECAR_AGENT_ID}/conversations`, SIDECAR_URL);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SIDECAR_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, role: "assistant", content: args.content }),
    });
    if (!res.ok) {
      console.error(`[contractmaker-mcp] logProactiveOutbound ${res.status} (ignorado)`);
    }
  } catch (err) {
    console.error(
      "[contractmaker-mcp] logProactiveOutbound falhou (ignorado):",
      err instanceof Error ? err.message : err,
    );
  }
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
