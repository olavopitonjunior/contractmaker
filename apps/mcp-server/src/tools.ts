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

  // ───────────── Newton mutations ─────────────
  {
    name: "move_deal_stage",
    description:
      "Move um deal para outro stage do mesmo pipeline. Reversível — outro PATCH com o stageId anterior desfaz. Pode também renomear via title. Use list_deals + get_deal pra descobrir stageIds válidos.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        stageId: { type: "string", description: "Novo stageId (deve pertencer ao mesmo pipeline)." },
        title: { type: "string", description: "Renomeia o deal." },
      },
      required: ["dealId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "PATCH",
        path: `/api/deals/${args.dealId}`,
        body: { stageId: args.stageId, title: args.title },
      });
      return r.body;
    },
  },
  {
    name: "mark_deal_signed",
    description:
      "Marca deal como assinado: move de 'Assinatura' para 'Concluído'. Falha se o deal não estiver no stage 'Assinatura'. Reversível via move_deal_stage.",
    inputSchema: {
      type: "object",
      properties: { dealId: { type: "string" } },
      required: ["dealId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${args.dealId}/mark-signed`,
      });
      return r.body;
    },
  },
  {
    name: "move_contract_status",
    description:
      "Move contrato entre 'rascunho' e 'review'. Para aprovação use approve_contract (HITL). Bloqueia em contratos já aprovados.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        status: { type: "string", enum: ["rascunho", "review"] },
      },
      required: ["contractId", "status"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "PATCH",
        path: `/api/contracts/${args.contractId}/status`,
        body: { status: args.status },
      });
      return r.body;
    },
  },
  {
    name: "request_certidao",
    description:
      "Solicita batch de certidões Infosimples para um deal. SEMPRE HITL — gera ActionIntent CERTIDAO_REQUEST que humano aprova em /intents/<id> antes de executar (gasta budget mensal). Auto-plan: o servidor decide quais certidões emitir baseado nos dados do deal/diligenciados. Newton gera batchId (UUID v4) upfront pra idempotência.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        batchId: {
          type: "string",
          description: "UUID v4 gerado pelo cliente. Mesmo batchId em retry retorna o mesmo resultado.",
        },
      },
      required: ["dealId", "batchId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${args.dealId}/certidoes-newton`,
        body: { batchId: args.batchId },
        idempotencyKey: args.batchId as string,
      });
      return r.body;
    },
  },
  {
    name: "upload_attachment",
    description:
      "Sobe um documento (PDF, JPG, PNG, WebP, GIF) pra um deal. Body JSON com base64Data — Newton codifica o arquivo. Limite 10MB. SHA-256 pre-warm: se o mesmo conteúdo já foi OCR'd na org, reusa extractedData/category. Sem HITL — reversível via DELETE.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        filename: { type: "string", description: "Nome original do arquivo." },
        mime: {
          type: "string",
          enum: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"],
        },
        base64Data: {
          type: "string",
          description: "Conteúdo em base64. Pode incluir ou não o prefixo data:<mime>;base64,",
        },
        category: {
          type: "string",
          description: "Categoria opcional (ex: 'matricula', 'rg', 'cnh').",
        },
      },
      required: ["dealId", "filename", "mime", "base64Data"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${args.dealId}/attachments-newton`,
        body: {
          filename: args.filename,
          mime: args.mime,
          base64Data: args.base64Data,
          category: args.category,
        },
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

  {
    name: "fill_form",
    description:
      "Preenche/atualiza dados de um SalesForm pelo token. Body { dataJson?, status?, title? }. dataJson faz deep-merge com o que já existe (não substitui). ATENÇÃO: setar status='completo' dispara auto-geração de contrato no servidor + dedup de cônjuges + linking de attachments + criação de DiligentedPerson pra sócios PJ. Use status='rascunho' para auto-save sem disparar nada. Endpoint público (token-as-tenancy) — qualquer um com o token edita.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token público do form (vem de create_form ou list_forms).",
        },
        dataJson: {
          type: "object",
          description: "Patch a aplicar no dataJson (deep-merge, não substitui o todo).",
        },
        status: {
          type: "string",
          enum: ["rascunho", "completo"],
          description: "Auto-save use 'rascunho'. Finalizar e gerar contrato use 'completo'.",
        },
        title: {
          type: "string",
          description: "Renomeia form e deal vinculado.",
        },
      },
      required: ["token"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "PATCH",
        path: `/api/forms/${args.token}`,
        body: {
          dataJson: args.dataJson,
          status: args.status,
          title: args.title,
        },
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
