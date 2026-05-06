import { callApi } from "./index.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  handler: ToolHandler;
}

/**
 * Tools MCP — mapeiam diretamente pra endpoints REST do Contractmaker.
 *
 * Convenção de nomes: verbo_objeto (snake_case). Verbos: get, list, create,
 * update, delete, approve, send, etc.
 *
 * Output: JSON do endpoint, stringified pelo wrapper.
 */
export const tools: Tool[] = [
  // ───────────── Leitura ─────────────
  {
    name: "get_my_metrics",
    description:
      "Retorna contagens agregadas de deals, contratos e cobranças do usuário autenticado. Sem PII nem valores monetários.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO 8601, opcional. Default: -30 dias.",
        },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/me/metrics",
        query: args.since ? { since: args.since as string } : undefined,
      });
      return r.body;
    },
  },
  {
    name: "get_my_activity",
    description: "Atividade recente do usuário (últimas N entradas do AuditLog).",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO 8601, opcional" },
        limit: { type: "number", description: "1-200, default 50" },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/me/activity",
        query: {
          since: args.since as string | undefined,
          limit: args.limit ? String(args.limit) : undefined,
        },
      });
      return r.body;
    },
  },
  {
    name: "get_events",
    description:
      "Polling do feed de eventos da org (envelope.signed, charge.received, etc). Cliente persiste `nextSince` localmente.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO 8601 obrigatório",
        },
        limit: { type: "number", description: "1-500, default 100" },
        actions: {
          type: "string",
          description: "CSV de actions a filtrar (ex: ENVELOPE_CREATE,CHARGE_CREATE)",
        },
      },
      required: ["since"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/events",
        query: {
          since: args.since as string,
          limit: args.limit ? String(args.limit) : undefined,
          actions: args.actions as string | undefined,
        },
      });
      return r.body;
    },
  },
  {
    name: "lookup_user_by_phone",
    description: "Mapeamento WhatsApp → user. Phone E.164 (+5511987654321).",
    inputSchema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "E.164" },
      },
      required: ["phone"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/users/by-phone",
        query: { phone: args.phone as string },
      });
      return r.body;
    },
  },
  {
    name: "get_contract_summary",
    description:
      "Sumário determinístico (sem LLM) de um contrato: status, partes, valor, envelope ativo, markdown pronto.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
      },
      required: ["contractId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/contracts/${args.contractId}/summary`,
      });
      return r.body;
    },
  },
  {
    name: "get_infosimples_budget",
    description: "Saldo mensal de certidões Infosimples da org.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const r = await callApi({
        method: "GET",
        path: "/api/org/infosimples-budget",
      });
      return r.body;
    },
  },

  // ───────────── Intents ─────────────
  {
    name: "list_pending_intents",
    description:
      "Lista ActionIntents pendentes do usuário. Retorna intents que precisam de aprovação humana.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "pending|approved|rejected|executed|expired|failed (default pending)",
        },
        limit: { type: "number" },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/me/intents",
        query: {
          status: (args.status as string | undefined) ?? "pending",
          limit: args.limit ? String(args.limit) : undefined,
        },
      });
      return r.body;
    },
  },
  {
    name: "get_intent_status",
    description: "Polling do status de uma intent específica.",
    inputSchema: {
      type: "object",
      properties: { intentId: { type: "string" } },
      required: ["intentId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/intents/${args.intentId}`,
      });
      return r.body;
    },
  },

  // ───────────── Ações executivas ─────────────
  {
    name: "approve_contract",
    description:
      "Aprova contrato. **Cria ActionIntent** que precisa de aprovação humana via UI antes de executar. Retorna 202 com intentId.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        force: {
          type: "boolean",
          description:
            "Se true, ignora warnings (não bypassa erros). Default false.",
        },
        idempotencyKey: {
          type: "string",
          description: "UUID v4 — uma key por intenção, retry-safe 24h",
        },
      },
      required: ["contractId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/contracts/${args.contractId}/approve`,
        body: { force: args.force ?? false },
        idempotencyKey: args.idempotencyKey as string | undefined,
      });
      return r.body;
    },
  },
  {
    name: "create_commission_charge",
    description:
      "Cria cobrança de comissão Asaas (PIX ou BOLETO). **Cria ActionIntent** que precisa de aprovação humana.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        billingType: { type: "string", enum: ["PIX", "BOLETO"] },
        dueDate: {
          type: "string",
          description: "YYYY-MM-DD",
        },
        contractId: {
          type: "string",
          description: "Opcional. Default: contrato aprovado mais recente",
        },
        description: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["dealId", "billingType", "dueDate"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${args.dealId}/commission-charges`,
        body: {
          billingType: args.billingType,
          dueDate: args.dueDate,
          contractId: args.contractId,
          description: args.description,
        },
        idempotencyKey: args.idempotencyKey as string | undefined,
      });
      return r.body;
    },
  },
  {
    name: "send_envelope",
    description:
      "Envia contrato pra assinatura ClickSign. **Cria ActionIntent** que precisa de aprovação humana.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        authMethod: {
          type: "string",
          enum: ["email", "whatsapp", "selfie", "icp_brasil"],
        },
        envelopeName: { type: "string" },
        deadlineAt: {
          type: "string",
          description: "ISO 8601",
        },
        idempotencyKey: { type: "string" },
      },
      required: ["contractId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/contracts/${args.contractId}/envelopes`,
        body: {
          authMethod: args.authMethod,
          envelopeName: args.envelopeName,
          deadlineAt: args.deadlineAt,
        },
        idempotencyKey: args.idempotencyKey as string | undefined,
      });
      return r.body;
    },
  },
  {
    name: "list_envelopes",
    description: "Lista envelopes ClickSign de um contrato (status, signers).",
    inputSchema: {
      type: "object",
      properties: { contractId: { type: "string" } },
      required: ["contractId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/contracts/${args.contractId}/envelopes`,
      });
      return r.body;
    },
  },

  // ───────────── Deals ─────────────
  {
    name: "list_deals",
    description:
      "Lista todos os deals do pipeline da org do usuário autenticado. Inclui stage, form vinculado e contrato mais recente. Ordenado por createdAt desc.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const r = await callApi({
        method: "GET",
        path: "/api/pipeline/deals",
      });
      return r.body;
    },
  },
  {
    name: "get_deal",
    description:
      "Retorna um deal específico com form vinculado e stage. Response inclui header ETag (updatedAt) — usar pra detecção de concorrência em writes futuros.",
    inputSchema: {
      type: "object",
      properties: { dealId: { type: "string" } },
      required: ["dealId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/deals/${args.dealId}`,
      });
      return r.body;
    },
  },

  // ───────────── Forms ─────────────
  {
    name: "list_forms",
    description:
      "Lista todos os SalesForms da org. Retorna form + deal vinculado (id, title) se houver. Ordenado por createdAt desc.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const r = await callApi({
        method: "GET",
        path: "/api/forms",
      });
      return r.body;
    },
  },
  {
    name: "create_form",
    description:
      "Cria um novo SalesForm (schema compra_venda_v1) e automaticamente cria um Deal vinculado no primeiro stage do pipeline (Formulário). Retorna { id, token, url, dealId }. Idempotente via idempotencyKey.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título do form/deal. Default: 'Negocio - <token-prefix>'.",
        },
        idempotencyKey: {
          type: "string",
          description: "UUID v4 — uma key por intenção, retry-safe 24h",
        },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: "/api/forms",
        body: { title: args.title },
        idempotencyKey: args.idempotencyKey as string | undefined,
      });
      return r.body;
    },
  },

  // ───────────── Contract Comments ─────────────
  {
    name: "list_contract_comments",
    description:
      "Lista comments de um contrato (apenas root-level; replies vêm aninhadas). Por default só não-resolvidos; passe includeResolved=true para incluir resolvidos.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        includeResolved: {
          type: "boolean",
          description: "Incluir comments resolvidos. Default false.",
        },
      },
      required: ["contractId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/contracts/${args.contractId}/comments`,
        query: args.includeResolved
          ? { includeResolved: "true" }
          : undefined,
      });
      return r.body;
    },
  },
  {
    name: "add_contract_comment",
    description:
      "Adiciona um comment a um contrato. selectedText é o trecho do contrato sendo comentado (precisa existir literal no Google Doc se contrato for GDoc — caso contrário 422). Newton aparece como autor com label 'Newton (em nome do user ...)'. Falha se contrato estiver aprovado.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        text: {
          type: "string",
          description: "O comment em si.",
        },
        selectedText: {
          type: "string",
          description:
            "Trecho exato do contrato sendo comentado (ancora o comment). Em GDocs precisa bater literal.",
        },
        severity: {
          type: "string",
          enum: ["info", "warning", "blocker"],
          description: "Default 'info'.",
        },
      },
      required: ["contractId", "text", "selectedText"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/contracts/${args.contractId}/comments`,
        body: {
          text: args.text,
          selectedText: args.selectedText,
          severity: args.severity,
        },
      });
      return r.body;
    },
  },
];
