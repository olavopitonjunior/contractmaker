import { callApi, callBridge } from "./index.js";

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
  {
    name: "extract_document_fields",
    description:
      "Extração ESTRUTURADA de documento de um attachment já uploaded. Diferente do OCR opaco do form, retorna campos com SCORE DE CONFIANÇA por campo (regex de validação + presença + partial markers). Use sempre antes de gravar dados de doc no form/deal — Newton recita campos pro humano confirmar (ver OCR.md). Suporta documentType: rg, cpf, cnh, matricula, iptu, escritura, procuracao, comprovante_residencia, certidao_casamento. Se documentType não for passado, classifica automaticamente. Resposta inclui `lowConfidenceFields[]` (perguntar antes de gravar) e `missingRequiredFields[]` (campos obrigatórios ausentes).",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        attachmentId: {
          type: "string",
          description: "ID do DealAttachment já uploaded (via upload_attachment ou form público).",
        },
        documentType: {
          type: "string",
          enum: [
            "rg",
            "cpf",
            "cnh",
            "matricula",
            "iptu",
            "escritura",
            "procuracao",
            "comprovante_residencia",
            "certidao_casamento",
          ],
          description: "Opcional. Força o schema. Sem isso, o servidor classifica via Gemini.",
        },
        idempotencyKey: {
          type: "string",
          description: "Opcional. UUID v4. Mesmo retry com mesma key retorna mesmo resultado em 24h.",
        },
      },
      required: ["dealId", "attachmentId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${args.dealId}/extract-fields`,
        body: {
          attachmentId: args.attachmentId,
          documentType: args.documentType,
          idempotencyKey: args.idempotencyKey,
        },
        idempotencyKey: args.idempotencyKey as string | undefined,
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

  // ───────────── Leads (Newton — pré-Deal) ─────────────
  {
    name: "list_leads",
    description:
      "Lista leads abertas/qualificadas/etc da org. Lead = caso em desenvolvimento (briefing recebido, docs sendo coletados) que ainda não virou Deal formal. Filtro por status (default 'open'). Use pra ver pipeline de pré-negocios.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "qualified", "converted", "lost", "archived"],
          description: "Default 'open'",
        },
        limit: { type: "number", description: "1-200, default 50" },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/leads",
        query: {
          status: args.status as string | undefined,
          limit: args.limit ? String(args.limit) : undefined,
        },
      });
      return r.body;
    },
  },
  {
    name: "create_lead",
    description:
      "Cria Lead nova (pré-Deal). Use quando negociadora manda briefing por WhatsApp. ⚠️ ANTES de criar, faça lookup_lead_by_phone pra cada phone das partes — se já existir lead com overlap >=70%, NÃO cria, atualiza. Lead vive em paralelo ao pipeline de Deals; vira Deal via convert_lead_to_deal quando matura.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Ex: 'Yamamoto - Vila Mariana'" },
        phones: {
          type: "array",
          items: { type: "string" },
          description: "E.164 com '+': ['+5511987654321', '+5511912345678']",
        },
        notes: { type: "string", description: "Briefing inicial em texto livre" },
        metadata: {
          type: "object",
          description:
            "JSON estruturado: { parties: [{nome, role, phone}], imovel: {...}, valor_estimado, source }",
        },
      },
      required: ["title"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: "/api/leads",
        body: {
          title: args.title,
          phones: args.phones,
          notes: args.notes,
          metadata: args.metadata,
        },
      });
      return r.body;
    },
  },
  {
    name: "lookup_lead_by_phone",
    description:
      "🔑 CRÍTICO pra multi-deal disambiguation. CHAME ESSA TOOL ANTES DE RESPONDER QUALQUER MENSAGEM DE WHATSAPP. Retorna leads abertas/qualificadas que tem o phone na lista de partes. Match=0: phone novo (cria lead OU pede briefing). Match=1: contexto inferido. Match>1: pergunta qual lead antes de prosseguir. Errar contexto é pior que perguntar.",
    inputSchema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "E.164 com '+': '+5511987654321'",
        },
      },
      required: ["phone"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/leads/by-phone",
        query: { phone: args.phone as string },
      });
      return r.body;
    },
  },
  {
    name: "convert_lead_to_deal",
    description:
      "Converte Lead em SalesForm + Deal no pipeline. Use quando lead amadureceu (preço definido, partes confirmadas, docs essenciais coletados). Cria Deal vazio com title da lead + dataJson herdado do metadata. Lead fica marcada status='converted' apontando pro deal. Negociadora completa form pela UI.",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
      },
      required: ["leadId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/leads/${args.leadId}/convert-to-deal`,
      });
      return r.body;
    },
  },

  // ───────────── Pipeline aggregates (client-side compositions) ─────────────
  {
    name: "summarize_pipeline",
    description:
      "Sumário rápido do pipeline aberto agrupado por stage. Útil pra briefing matinal e overviews — compõe list_deals + agrega sem ir 2x no backend. Retorna { byStage: { <stageName>: { count, deals: [{id, title}] } }, totalOpen, totalClosed, generatedAt }.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const r = await callApi({ method: "GET", path: "/api/pipeline/deals" });
      const deals = Array.isArray(r.body)
        ? r.body
        : (r.body as { deals?: unknown[] })?.deals ?? [];
      const TERMINAL = new Set(["Concluído", "Concluido", "Cancelado", "Perdido"]);
      const byStage: Record<string, { count: number; deals: Array<{ id: string; title?: string }> }> = {};
      let totalOpen = 0;
      let totalClosed = 0;
      for (const raw of deals as Array<Record<string, unknown>>) {
        const stage = typeof raw.stage === "string" ? raw.stage : "Desconhecido";
        const id = typeof raw.id === "string" ? raw.id : "";
        const title = typeof raw.title === "string" ? raw.title : undefined;
        if (TERMINAL.has(stage)) {
          totalClosed++;
        } else {
          totalOpen++;
          if (!byStage[stage]) byStage[stage] = { count: 0, deals: [] };
          byStage[stage].count++;
          byStage[stage].deals.push({ id, title });
        }
      }
      return { byStage, totalOpen, totalClosed, generatedAt: new Date().toISOString() };
    },
  },
  {
    name: "list_stale_deals",
    description:
      "Lista deals que ultrapassaram o SLA do seu stage atual (parado tempo demais). Compõe list_deals + calcula gap baseado em lastStageChangeAt|updatedAt. SLA default por stage (em dias): Lead 2, Briefing 2, Documentação 4, Análise 3, Aprovação 2, Assinatura 5. Aceita slaOverride pra customizar. Retorna { stale: [{id, title, stage, daysParked, slaDays, lastChangeAt}], generatedAt }. Vazio se nenhum estagnado.",
    inputSchema: {
      type: "object",
      properties: {
        slaOverride: {
          type: "object",
          description:
            "Opcional. Map { stageName: days } pra sobrescrever SLA default. Stages não listados usam default.",
        },
      },
    },
    handler: async (args) => {
      const DEFAULT_SLA: Record<string, number> = {
        Lead: 2,
        Briefing: 2,
        Documentação: 4,
        Documentacao: 4,
        Análise: 3,
        Analise: 3,
        Aprovação: 2,
        Aprovacao: 2,
        Assinatura: 5,
      };
      const override = (args.slaOverride as Record<string, number>) ?? {};
      const sla = { ...DEFAULT_SLA, ...override };
      const TERMINAL = new Set(["Concluído", "Concluido", "Cancelado", "Perdido"]);

      const r = await callApi({ method: "GET", path: "/api/pipeline/deals" });
      const deals = Array.isArray(r.body)
        ? r.body
        : (r.body as { deals?: unknown[] })?.deals ?? [];
      const now = Date.now();
      const stale: Array<{
        id: string;
        title?: string;
        stage: string;
        daysParked: number;
        slaDays: number;
        lastChangeAt: string;
      }> = [];

      for (const raw of deals as Array<Record<string, unknown>>) {
        const stage = typeof raw.stage === "string" ? raw.stage : "";
        if (TERMINAL.has(stage)) continue;
        const slaDays = sla[stage] ?? null;
        if (slaDays === null) continue;
        const lastChange =
          (typeof raw.lastStageChangeAt === "string" && raw.lastStageChangeAt) ||
          (typeof raw.updatedAt === "string" && raw.updatedAt) ||
          (typeof raw.createdAt === "string" && raw.createdAt) ||
          null;
        if (!lastChange) continue;
        const lastMs = new Date(lastChange).getTime();
        if (!Number.isFinite(lastMs)) continue;
        const daysParked = Math.floor((now - lastMs) / (24 * 3600 * 1000));
        if (daysParked > slaDays) {
          stale.push({
            id: typeof raw.id === "string" ? raw.id : "",
            title: typeof raw.title === "string" ? raw.title : undefined,
            stage,
            daysParked,
            slaDays,
            lastChangeAt: lastChange,
          });
        }
      }
      stale.sort((a, b) => b.daysParked - a.daysParked);
      return { stale, generatedAt: new Date().toISOString() };
    },
  },

  {
    name: "list_overdue_charges",
    description:
      "Lista cobranças em atraso (currentDueDate < hoje E status != PAID). Compõe /api/financeiro/charges?status=PENDING,CONFIRMED + filtra client-side por currentDueDate. Útil pra régua semanal de comissão atrasada. Retorna { overdue: [{id, dealTitle, customerName, value, currentDueDate, daysOverdue, status, asaasPaymentId}], total, generatedAt }. Vazio se nada atrasado.",
    inputSchema: {
      type: "object",
      properties: {
        graceDays: {
          type: "number",
          description:
            "Opcional. Tolerância em dias antes de considerar atrasado (default 0 = considera atrasado no mesmo dia do vencimento).",
        },
      },
    },
    handler: async (args) => {
      const graceDays = typeof args.graceDays === "number" ? args.graceDays : 0;
      // Status não-pagos: PENDING (aguardando pagamento), CONFIRMED (recebido mas
      // não conciliado), AWAITING_RISK_ANALYSIS, OVERDUE (caso o backend já marque).
      // Asaas usa esses + RECEIVED/CONFIRMED. PAID/RECEIVED_IN_CASH são finais.
      const r = await callApi({
        method: "GET",
        path: "/api/financeiro/charges",
        query: {
          status: "PENDING,CONFIRMED,AWAITING_RISK_ANALYSIS,OVERDUE",
          limit: "100",
        },
      });
      const body = r.body as { rows?: Array<Record<string, unknown>> };
      const rows = body?.rows ?? [];
      const cutoff = Date.now() - graceDays * 24 * 3600 * 1000;
      const overdue: Array<{
        id: string;
        dealTitle?: string;
        customerName?: string;
        value: unknown;
        currentDueDate: string;
        daysOverdue: number;
        status: string;
        asaasPaymentId?: string;
      }> = [];
      for (const c of rows) {
        const due =
          typeof c.currentDueDate === "string" ? c.currentDueDate : null;
        if (!due) continue;
        const dueMs = new Date(due).getTime();
        if (!Number.isFinite(dueMs) || dueMs > cutoff) continue;
        const daysOverdue = Math.floor((Date.now() - dueMs) / (24 * 3600 * 1000));
        const deal = c.deal as { title?: string } | undefined;
        const customer = c.customer as { name?: string } | undefined;
        overdue.push({
          id: String(c.id ?? ""),
          dealTitle: deal?.title,
          customerName: customer?.name,
          value: c.value,
          currentDueDate: due,
          daysOverdue,
          status: String(c.status ?? ""),
          asaasPaymentId:
            typeof c.asaasPaymentId === "string" ? c.asaasPaymentId : undefined,
        });
      }
      overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
      return { overdue, total: overdue.length, generatedAt: new Date().toISOString() };
    },
  },

  {
    name: "list_aging_certidoes",
    description:
      "Lista certidões emitidas há ≥ daysOld dias (default 25). Usado pra alertar antes do vencimento (certidão Infosimples vale 30 dias da finishedAt). Retorna { aging: [{id, dealId, label, endpoint, finishedAt, daysOld, status}], total, generatedAt }. Vazio se nenhuma envelhecendo.",
    inputSchema: {
      type: "object",
      properties: {
        daysOld: {
          type: "number",
          description:
            "Idade mínima em dias da certidão pra ser listada. Default 25 (alerta 5 dias antes do vencimento de 30d).",
        },
      },
    },
    handler: async (args) => {
      const daysOld = typeof args.daysOld === "number" ? args.daysOld : 25;
      const r = await callApi({
        method: "GET",
        path: "/api/certidoes",
        query: { status: "done", daysOld: String(daysOld), limit: "100" },
      });
      const body = r.body as { rows?: Array<Record<string, unknown>> };
      const rows = body?.rows ?? [];
      const now = Date.now();
      const aging: Array<{
        id: string;
        dealId?: string;
        label?: string;
        endpoint?: string;
        finishedAt: string;
        daysOld: number;
        status: string;
      }> = [];
      for (const row of rows) {
        const finishedAt =
          typeof row.finishedAt === "string" ? row.finishedAt : null;
        if (!finishedAt) continue;
        const finishedMs = new Date(finishedAt).getTime();
        if (!Number.isFinite(finishedMs)) continue;
        const ageDays = Math.floor((now - finishedMs) / (24 * 3600 * 1000));
        aging.push({
          id: String(row.id ?? ""),
          dealId: typeof row.dealId === "string" ? row.dealId : undefined,
          label: typeof row.label === "string" ? row.label : undefined,
          endpoint: typeof row.endpoint === "string" ? row.endpoint : undefined,
          finishedAt,
          daysOld: ageDays,
          status: String(row.status ?? ""),
        });
      }
      aging.sort((a, b) => b.daysOld - a.daysOld);
      return { aging, total: aging.length, generatedAt: new Date().toISOString() };
    },
  },

  // ───────────── WhatsApp ─────────────
  {
    name: "whatsapp_send",
    description:
      "Envia mensagem WhatsApp via Meta Cloud bridge (whatsapp-bridge.ia.br). Use quando quiser proativamente mandar mensagem fora do fluxo de resposta natural ao webhook (ex: avisar cliente que documento foi recebido, lembrar prazo, comentar em grupo). Phone deve ser E.164 sem '+': '5511987654321'. Body até 4096 chars. Opcional replyToMessageId pra responder uma mensagem específica em contexto. Retorna { messages: [{id}] } com wamid.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Phone E.164 SEM o '+': ex 5511987654321",
        },
        body: {
          type: "string",
          description: "Texto da mensagem (até 4096 chars).",
        },
        replyToMessageId: {
          type: "string",
          description: "Opcional. wamid de msg pra responder em contexto.",
        },
      },
      required: ["to", "body"],
    },
    handler: async (args) => {
      const body: Record<string, unknown> = {
        to: args.to,
        body: args.body,
      };
      if (args.replyToMessageId) {
        body.context = { message_id: args.replyToMessageId };
      }
      const r = await callBridge({ path: "/api/send", body });
      return r.body;
    },
  },
];
