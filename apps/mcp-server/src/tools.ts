import { spawn } from "node:child_process";
import { callApi, callBridge } from "./index.js";
import { validateInWindow } from "./cron-window.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Extrai o NOME do stage de um deal de /api/pipeline/deals. O backend devolve
 * `stage` como objeto { id, name, ... } (relation incluída) — antes a gente lia
 * `raw.stage` como string e caía sempre em "Desconhecido". Tolera string legada.
 */
function stageName(raw: Record<string, unknown>): string | null {
  const s = raw.stage;
  if (s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string") {
    return (s as { name: string }).name;
  }
  if (typeof s === "string") return s;
  return null;
}

/**
 * Spawn `openclaw cron <args> --json`. Como o MCP server roda dentro do mesmo
 * container do gateway openclaw, o binário `openclaw` está na PATH e o token
 * é resolvido naturalmente via OPENCLAW_GATEWAY_TOKEN herdado do env.
 *
 * Decisão arquitetural 2026-05-16: substituiu a abordagem original via sidecar
 * (que exigiria docker.sock mount). Detalhes em
 * docs/newton-proactive-dispatch-2026-05-16.md (seção "Correção arquitetural").
 */
async function spawnOpenclawCron(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("openclaw", ["cron", ...args, "--json"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(`openclaw cron exit=${code} stderr=${stderr.trim()}`)
        );
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to parse cron JSON: ${msg} raw=${stdout}`));
      }
    });
  });
}

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
        const stage = stageName(raw) ?? "Desconhecido";
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
        const stage = stageName(raw) ?? "";
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

  // ───────────── Proactive Dispatch ─────────────
  // 3 tools que wrappam o `openclaw cron` CLI (mesmo container). Persona em
  // PROACTIVE.md define o protocolo de uso (confirmação verbal, anti-spam,
  // saída fácil, etc). Validação de janela 7-22h é server-side via
  // validateInWindow — Newton não decide isso.
  {
    name: "schedule_proactive_message",
    description:
      "Agenda dispatch proativo (cron job) que Newton dispara em hora marcada. " +
      "Use quando o user pedir lembretes/agendamentos recorrentes ou one-shot " +
      "('me lembra todo dia 9h', 'manda pra Cris segunda 10h'). " +
      "SEMPRE confirma com o user antes de chamar (regra PROACTIVE.md). " +
      "Default channel='whatsapp' (Newton é WhatsApp-first); Telegram só se " +
      "user pedir explícito ou destinatário não tiver WA. " +
      "Janela 7h-22h SP enforced server-side; cron fora da janela retorna erro. " +
      "Exatamente um de cron/every/at obrigatório.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Slug human-readable a-z0-9_- (ex: 'briefing-cris', 'vistoria-yamamoto')",
        },
        description: {
          type: "string",
          description: "Motivo do agendamento, p/ memory_store posterior",
        },
        cron: {
          type: "string",
          description: "Expressão cron 5 ou 6 campos, ex: '0 9 * * 1-5'",
        },
        every: {
          type: "string",
          description: "Alternativa: '10m', '1h', '24h'",
        },
        at: {
          type: "string",
          description: "Alternativa one-shot: ISO datetime ou '+30m'",
        },
        tz: {
          type: "string",
          description: "Timezone IANA, default 'America/Sao_Paulo'",
        },
        channel: {
          type: "string",
          enum: ["whatsapp", "telegram"],
          description: "Default 'whatsapp'. Telegram só se necessário.",
        },
        to: {
          type: "string",
          description: "Phone E.164 sem '+' (WA) ou chatId numérico (Telegram)",
        },
        message: {
          type: "string",
          description:
            "Texto fixo OU template. Template pode conter instruções tipo " +
            "'consulta a pipeline e me dá um resumo' — Newton resolve no trigger.",
        },
        expectFinal: {
          type: "boolean",
          description: "Aguarda resposta final do agente. Default true.",
        },
        oneShot: {
          type: "boolean",
          description: "Deleta o job após primeiro run. Default false.",
        },
      },
      required: ["name", "to", "message"],
    },
    handler: async (args) => {
      const name = args.name as string;
      const channel = (args.channel as string | undefined) ?? "whatsapp";
      const tz = (args.tz as string | undefined) ?? "America/Sao_Paulo";
      const cronExpr = args.cron as string | undefined;
      const every = args.every as string | undefined;
      const at = args.at as string | undefined;
      const to = args.to as string;
      const message = args.message as string;

      const whenCount = [cronExpr, every, at].filter(Boolean).length;
      if (whenCount !== 1) {
        throw new Error("exatamente um de cron/every/at obrigatório");
      }
      if (cronExpr) {
        const v = validateInWindow(cronExpr);
        if (!v.ok) throw new Error(`Window check: ${v.reason}`);
      }

      const cli: string[] = [
        "add",
        "--agent",
        "main",
        "--name",
        name,
        "--channel",
        channel,
        "--to",
        to,
        "--message",
        message,
        "--tz",
        tz,
      ];
      if (args.description) cli.push("--description", args.description as string);
      if (cronExpr) cli.push("--cron", cronExpr);
      if (every) cli.push("--every", every);
      if (at) cli.push("--at", at);
      if (args.expectFinal !== false) cli.push("--expect-final");
      if (args.oneShot === true) cli.push("--delete-after-run");
      cli.push("--announce");

      return spawnOpenclawCron(cli);
    },
  },
  {
    name: "list_proactive_dispatches",
    description:
      "Lista dispatches agendados (jobs do cron plugin). Filtros opcionais por " +
      "destinatário (`to`) ou prefixo de nome. Use pra responder 'lista meus " +
      "lembretes' ou pra encontrar IDs antes de cancelar.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Phone/chatId — filtra só desse destinatário" },
        namePrefix: { type: "string" },
      },
    },
    handler: async (args) => {
      const result = (await spawnOpenclawCron(["list", "--all"])) as
        | { jobs?: unknown[] }
        | unknown[];
      let jobs: unknown[] = Array.isArray(result)
        ? result
        : Array.isArray((result as { jobs?: unknown[] }).jobs)
          ? (result as { jobs: unknown[] }).jobs
          : [];
      if (args.to) {
        const to = args.to as string;
        jobs = jobs.filter((j) => {
          const job = j as Record<string, unknown>;
          return job.to === to || job.destination === to;
        });
      }
      if (args.namePrefix) {
        const prefix = args.namePrefix as string;
        jobs = jobs.filter((j) => {
          const job = j as Record<string, unknown>;
          return typeof job.name === "string" && job.name.startsWith(prefix);
        });
      }
      return { jobs };
    },
  },
  {
    name: "cancel_proactive_dispatch",
    description:
      "Cancela dispatch agendado pelo id. Persona pede confirmação verbal antes. " +
      "Após cancelar, registra memory_store pra rastreabilidade.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID do cron job (vem do list)" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = args.id as string;
      return spawnOpenclawCron(["rm", id]);
    },
  },

  // ───────────── Newton Requests (cobrança de info a partir do negócio) ─────────────
  // A negociadora registra, de dentro do Deal, uma informação que falta e para
  // quem cobrar. Newton recebe o gatilho ([deal-request · sistema]), lê o pedido,
  // cobra via whatsapp_send, agenda lembretes (schedule_proactive_message) e fecha
  // com update_newton_request quando a info chega. Protocolo em persona REQUESTS.md.
  {
    name: "list_newton_requests",
    description:
      "Lista pedidos da negociadora ao Newton (fila de cobrança de info ancorada em Deal). " +
      "Use no gatilho [deal-request] (filtra por dealId) e ao receber resposta de um contato/grupo " +
      "(filtra por targetRef=telefone ou groupId pra achar o pedido aberto que aquela resposta fecha). " +
      "Sem status, retorna pendentes (open|chasing|awaiting_reply). Retorna { requests: [{id, dealId, " +
      "ask, targetType, targetRef, targetLabel, status, priority, cronJobIds, events, ...}] }.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "Filtra pedidos de um negócio" },
        status: {
          type: "string",
          description:
            "Filtro de status (CSV aceito): open|chasing|awaiting_reply|fulfilled|cancelled. " +
            "Default = pendentes.",
        },
        targetRef: {
          type: "string",
          description: "Telefone E.164 sem '+' — acha pedidos que cobram este contato",
        },
        groupId: {
          type: "string",
          description: "JID do grupo — acha pedidos do(s) deal(s) vinculado(s) a este grupo",
        },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/newton/requests",
        query: {
          dealId: args.dealId as string | undefined,
          status: args.status as string | undefined,
          targetRef: args.targetRef as string | undefined,
          groupId: args.groupId as string | undefined,
        },
        actAsUserId: args.actAsUserId as string | undefined,
      });
      return r.body;
    },
  },
  {
    name: "update_newton_request",
    description:
      "Atualiza o andamento de um pedido (write). action: 'chasing' (cobrou — passe cronJobIds " +
      "dos lembretes que agendou), 'awaiting' (aguardando resposta), 'fulfilled' (info chegou — passe " +
      "resolutionNote; o backend avisa a negociadora in-app e fecha), 'note' (só registra evento). " +
      "Ao fechar (fulfilled), MANDE TAMBÉM um DM via whatsapp_send pra negociadora avisando.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id do NewtonRequest" },
        action: {
          type: "string",
          enum: ["chasing", "awaiting", "fulfilled", "note"],
        },
        note: { type: "string", description: "Texto livre p/ timeline" },
        resolutionNote: {
          type: "string",
          description: "Resumo do que chegou (usado no fechamento e na notificação)",
        },
        cronJobIds: {
          type: "array",
          items: { type: "string" },
          description: "ids dos crons de lembrete agendados (acumula, dedupe)",
        },
      },
      required: ["id", "action"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "PATCH",
        path: `/api/newton/requests/${args.id}`,
        body: {
          action: args.action,
          note: args.note,
          resolutionNote: args.resolutionNote,
          cronJobIds: args.cronJobIds,
        },
        actAsUserId: args.actAsUserId as string | undefined,
      });
      return r.body;
    },
  },
  {
    name: "resolve_deal_group",
    description:
      "Descobre qual grupo de WhatsApp está vinculado a um Deal (read). Use ANTES de cobrar em grupo. " +
      "Retorna { link: { groupId, groupLabel, ... } } ou { link: null } se ainda não houver vínculo — " +
      "neste caso, confirme com o operador qual é o grupo do negócio e grave com link_deal_group.",
    inputSchema: {
      type: "object",
      properties: { dealId: { type: "string" } },
      required: ["dealId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/newton/deal-group-link",
        query: { dealId: args.dealId as string },
        actAsUserId: args.actAsUserId as string | undefined,
      });
      return r.body;
    },
  },
  {
    name: "lookup_deal_by_group",
    description:
      "Inverso de resolve_deal_group: dado um groupId, retorna o(s) deal(s) vinculado(s) (read). " +
      "Use ao receber uma resposta num grupo pra saber a qual negócio (e pedidos abertos) ela pertence.",
    inputSchema: {
      type: "object",
      properties: { groupId: { type: "string", description: "JID do grupo WhatsApp" } },
      required: ["groupId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/newton/deal-group-link",
        query: { groupId: args.groupId as string },
        actAsUserId: args.actAsUserId as string | undefined,
      });
      return r.body;
    },
  },
  {
    name: "link_deal_group",
    description:
      "Grava/atualiza o vínculo deal ↔ grupo de WhatsApp (write, upsert por dealId). Chame na 1ª vez " +
      "que associar um grupo a um negócio, DEPOIS de confirmar com o operador. groupId é o JID do grupo " +
      "(ex: '120363019502650977-group').",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        groupId: { type: "string", description: "JID do grupo WhatsApp" },
        groupLabel: { type: "string", description: "Nome humano do grupo (opcional)" },
      },
      required: ["dealId", "groupId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: "/api/newton/deal-group-link",
        body: {
          dealId: args.dealId,
          groupId: args.groupId,
          groupLabel: args.groupLabel,
        },
        actAsUserId: args.actAsUserId as string | undefined,
      });
      return r.body;
    },
  },

  // ───────────── RBAC delegation (Fase B do plano newton-rbac-hardening) ─────────────
  // Tools que viabilizam Newton operar com identidade do caller em vez do
  // token admin org-wide. Persona em SOUL.md ("Quem está falando comigo")
  // manda chamar resolve_caller PRIMEIRA TOOL de todo turn em DM, depois
  // propagar `actAsUserId` retornado pra todas as tool calls subsequentes.
  // Sem actAsUserId, backend opera no modo legado (token owner = admin → vê
  // tudo). Com actAsUserId + DELEGATION_ENABLED=true backend filtra por role.
  {
    name: "resolve_caller",
    description:
      "PRIMEIRA tool de todo turn em DM: mapeia phone E.164 → identidade + " +
      "scope acessível (deals/contracts permitidos). Retorna `actAsUserId` que " +
      "DEVE ser propagado em todas as tool calls subsequentes do mesmo turn pra " +
      "scope server-side aplicar. Em grupo, NÃO chame (contexto vem do grupo, " +
      "não do remetente). `notFound: true` = trate como Lead novo.",
    inputSchema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Phone E.164 do caller (ex: '+5511999063228' com '+')",
        },
      },
      required: ["phone"],
    },
    handler: async (args) => {
      const phone = args.phone as string;
      const r = await callApi({
        method: "GET",
        path: "/api/users/by-phone",
        query: { phone, withScope: "true" },
      });
      if (r.status === 404) {
        return { notFound: true };
      }
      const body = r.body as Record<string, unknown>;
      return {
        actAsUserId: body.userId,
        name: body.name,
        role: body.role,
        orgId: body.orgId,
        accessibleDealIds: body.accessibleDealIds ?? [],
        accessibleContractIds: body.accessibleContractIds ?? [],
        scopeCapped: body.scopeCapped ?? false,
      };
    },
  },
  {
    name: "get_contract_doc_link",
    description:
      "Retorna o Google Docs URL do contrato. Read-only. Newton manda esse " +
      "URL no chat; user clica e abre. Backend valida acesso via cross-user " +
      "guard. Passe `actAsUserId` se houver delegação ativa pro filtro server-side.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        actAsUserId: {
          type: "string",
          description: "Vindo de resolve_caller. Omita se admin-mode.",
        },
      },
      required: ["contractId"],
    },
    handler: async (args) => {
      const contractId = args.contractId as string;
      const actAsUserId = args.actAsUserId as string | undefined;
      const r = await callApi({
        method: "GET",
        path: `/api/contracts/${encodeURIComponent(contractId)}/summary`,
        actAsUserId,
      });
      if (r.status !== 200) return r;
      const summary = r.body as Record<string, unknown>;
      return {
        contractId,
        gdocUrl: summary.gdocUrl ?? null,
        status: summary.status,
        version: summary.version,
      };
    },
  },
  {
    name: "download_attachment",
    description:
      "Retorna URL pra baixar attachment já uploaded. Read-only. Use pra " +
      "entregar doc que o user pediu de volta no chat. NÃO use pra documentos " +
      "sigilosos em conversa de grupo (per OCR.md regra 6). Passe `actAsUserId` " +
      "se houver delegação ativa.",
    inputSchema: {
      type: "object",
      properties: {
        attachmentId: { type: "string" },
        actAsUserId: { type: "string", description: "Opcional, vindo de resolve_caller" },
      },
      required: ["attachmentId"],
    },
    handler: async (args) => {
      const attachmentId = args.attachmentId as string;
      const actAsUserId = args.actAsUserId as string | undefined;
      const r = await callApi({
        method: "GET",
        path: `/api/attachments/${encodeURIComponent(attachmentId)}/url`,
        actAsUserId,
      });
      return r.body;
    },
  },
  {
    name: "update_contract_field",
    description:
      "HITL. Cria ActionIntent pra atualizar UM campo do contrato. Owner aprova " +
      "via UI. Whitelist de campos (counterparty.{cpf,rg,name,address}, " +
      "pagamento.{valor_total,forma,prazo}, vigencia.{data_inicio,data_fim}, " +
      "imovel.{endereco,matricula}). Bloqueia se contrato já aprovado. " +
      "SEMPRE confirma verbalmente com user antes de chamar.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        fieldPath: {
          type: "string",
          description: "Path da whitelist (ex: 'vendedores[0].cpf', 'pagamento.valor_total')",
        },
        value: {
          description: "string | number | null. Tipo correto pra o campo escolhido.",
        },
        idempotencyKey: {
          type: "string",
          description: "UUID v4. Retry com mesma key dentro de 24h retorna mesma intent.",
        },
        actAsUserId: { type: "string", description: "Opcional, vindo de resolve_caller" },
      },
      required: ["contractId", "fieldPath", "value", "idempotencyKey"],
    },
    handler: async (args) => {
      const contractId = args.contractId as string;
      const r = await callApi({
        method: "POST",
        path: `/api/contracts/${encodeURIComponent(contractId)}/intents/update-field`,
        body: { fieldPath: args.fieldPath, value: args.value },
        idempotencyKey: args.idempotencyKey as string,
        actAsUserId: args.actAsUserId as string | undefined,
      });
      return r.body;
    },
  },
  {
    name: "cancel_envelope",
    description:
      "HITL. Cria ActionIntent pra cancelar envelope ClickSign já enviado. " +
      "Owner aprova via UI. Bloqueia se envelope em estado terminal " +
      "(closed/canceled/failed). SEMPRE confirma verbalmente com user antes.",
    inputSchema: {
      type: "object",
      properties: {
        envelopeId: { type: "string" },
        reason: { type: "string", minLength: 3, maxLength: 500 },
        idempotencyKey: { type: "string", description: "UUID v4" },
        actAsUserId: { type: "string", description: "Opcional, vindo de resolve_caller" },
      },
      required: ["envelopeId", "reason", "idempotencyKey"],
    },
    handler: async (args) => {
      const envelopeId = args.envelopeId as string;
      const r = await callApi({
        method: "POST",
        path: `/api/envelopes/${encodeURIComponent(envelopeId)}/cancel`,
        body: { reason: args.reason },
        idempotencyKey: args.idempotencyKey as string,
        actAsUserId: args.actAsUserId as string | undefined,
      });
      return r.body;
    },
  },

  // ───────────── Seguros / fiança (locação) ─────────────
  {
    name: "record_insurance_quote",
    description:
      "Registra no ImobPro o resultado de seguro de um contrato de locação. ramo='incendio' grava/atualiza a cotação (InsurancePolicy, status 'cotacao'); ramo='fianca' grava a fiança consolidada (Guarantee = fonte-da-verdade, com o comparativo SegurosJá+Alpop em consolidado). Idempotente por externalRef. Precisa do leaseContractId (use get_deal_insurance/get_deal).",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        leaseContractId: { type: "string" },
        ramo: { type: "string", enum: ["incendio", "fianca"] },
        seguradora: { type: "string", description: "(incendio) nome da seguradora." },
        provider: { type: "string", description: "(fianca) fonte escolhida (ex: SegurosJá / Alpop)." },
        status: { type: "string", description: "Status do ramo (incendio: cotacao|ativa|...; fianca: em_analise|aprovada|...)." },
        premioMensal: { type: "number" },
        coberturaMeses: { type: "number", description: "(fianca) meses de cobertura." },
        coberturaJson: { type: "object", description: "(incendio) coberturas/tiers.", additionalProperties: true },
        consolidado: { type: "object", description: "(fianca) comparativo consolidado SegurosJá+Alpop.", additionalProperties: true },
        custoJson: { type: "object", description: "(fianca) custo da opção escolhida.", additionalProperties: true },
        vigenciaInicio: { type: "string", description: "(incendio) ISO date." },
        vigenciaFim: { type: "string", description: "(incendio) ISO date." },
        responsavelPagamento: { type: "string", enum: ["imobiliaria", "locatario", "proprietario"] },
        externalRef: { type: "string", description: "Id da cotação/análise na fonte (idempotência)." },
      },
      required: ["dealId", "leaseContractId", "ramo"],
    },
    handler: async (args) => {
      const dealId = String(args.dealId);
      const { dealId: _omit, ...body } = args as Record<string, unknown>;
      const r = await callApi({
        method: "POST",
        path: `/api/locacao/deals/${encodeURIComponent(dealId)}/insurance-newton`,
        body,
      });
      return r.body;
    },
  },
  {
    name: "get_deal_insurance",
    description:
      "Lê os seguros de um contrato de locação: apólices (incêndio/conteúdo) + a garantia de fiança (Guarantee) com o comparativo consolidado. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        leaseContractId: { type: "string" },
      },
      required: ["dealId", "leaseContractId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/locacao/deals/${encodeURIComponent(String(args.dealId))}/insurance-newton`,
        query: { leaseContractId: args.leaseContractId as string },
      });
      return r.body;
    },
  },
  {
    name: "record_credit_analysis",
    description:
      "Grava no ImobPro a análise de crédito de um pretendente (CreditAnalysis) — veredito do underwriting consolidado SegurosJá/Alpop (Serasa fora de escopo). Uma por pretendente; o veredito de nível-deal é o pior caso entre os pretendentes. Idempotente por (tenant, deal).",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "Deal de locação (contexto + leaseDealId)." },
        tenantId: { type: "string", description: "Id do pretendente (Tenant) no ImobPro." },
        status: {
          type: "string",
          enum: ["pendente", "aprovado", "aprovado_com_garantia", "analise_manual", "recusado"],
        },
        decisionJson: { type: "object", description: "Comparativo consolidado SegurosJá+Alpop.", additionalProperties: true },
        scoreInterno: { type: "number" },
        externalRef: { type: "string" },
      },
      required: ["dealId", "tenantId", "status"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/locacao/deals/${encodeURIComponent(String(args.dealId))}/insurance-newton`,
        body: {
          ramo: "credito",
          tenantId: args.tenantId,
          leaseDealId: args.dealId,
          status: args.status,
          decisionJson: args.decisionJson,
          scoreInterno: args.scoreInterno,
          externalRef: args.externalRef,
        },
      });
      return r.body;
    },
  },

  // ───────────── Locação — leitura (Max, scope locacao:r) ─────────────
  {
    name: "list_lease_contracts",
    description:
      "Lista contratos de locação da org (LeaseContract) com imóvel, locatários e garantia. Filtros: status, propertyId, tenant (nome ou CPF/CNPJ).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["rascunho", "assinatura", "ativo", "renovacao", "rescisao", "encerrado"],
        },
        propertyId: { type: "string" },
        tenant: { type: "string", description: "Nome (contains) ou CPF/CNPJ do locatário" },
        offset: { type: "number" },
        limit: { type: "number", description: "1-100, default 50" },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/locacao/leases",
        query: {
          status: args.status as string | undefined,
          propertyId: args.propertyId as string | undefined,
          tenant: args.tenant as string | undefined,
          offset: args.offset ? String(args.offset) : undefined,
          limit: args.limit ? String(args.limit) : undefined,
        },
      });
      return r.body;
    },
  },
  {
    name: "get_lease_contract",
    description:
      "Detalhe de um contrato de locação: imóvel, locatários (com CPF/contato), garantia completa e apólices. Sem dados bancários de repasse.",
    inputSchema: {
      type: "object",
      properties: { leaseContractId: { type: "string" } },
      required: ["leaseContractId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/locacao/leases/${encodeURIComponent(args.leaseContractId as string)}`,
      });
      return r.body;
    },
  },
  {
    name: "list_lease_clients",
    description:
      "Lista clientes/prospects de locação (LeaseClient — pretendentes em análise, ≠ Tenant). Filtro q busca por nome/documento.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string", description: "Busca por nome/documento" } },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/locacao/clients",
        query: args.q ? { q: args.q as string } : undefined,
      });
      return r.body;
    },
  },
  {
    name: "get_lease_client",
    description:
      "Detalhe de um cliente/prospect de locação (ficha, análise de crédito, consentimento Serasa).",
    inputSchema: {
      type: "object",
      properties: { clientId: { type: "string" } },
      required: ["clientId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/locacao/clients/${encodeURIComponent(args.clientId as string)}`,
      });
      return r.body;
    },
  },
  {
    name: "list_insurer_analyses",
    description:
      "Lista as análises de fiança por seguradora (InsurerAnalysis) de um cliente de locação — status por seguradora (SegurosJá, Alpop...).",
    inputSchema: {
      type: "object",
      properties: { clientId: { type: "string" } },
      required: ["clientId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/locacao/clients/${encodeURIComponent(args.clientId as string)}/insurer-analyses`,
      });
      return r.body;
    },
  },
  {
    name: "list_lease_guarantees",
    description:
      "Lista garantias locatícias (Guarantee: fiador, seguro_fianca, titulo_capitalizacao, caucao...). Filtro opcional por leaseContractId.",
    inputSchema: {
      type: "object",
      properties: { leaseContractId: { type: "string" } },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/locacao/guarantees",
        query: args.leaseContractId
          ? { leaseContractId: args.leaseContractId as string }
          : undefined,
      });
      return r.body;
    },
  },
  {
    name: "list_insurance_policies",
    description:
      "Lista apólices/cotações de seguro de locação (InsurancePolicy). Filtros: status, tipo, leaseContractId, expiringInDays (renovações).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["cotacao", "em_analise", "pendente", "ativa", "vencida", "cancelada"],
        },
        tipo: {
          type: "string",
          enum: ["seguro_incendio", "seguro_fianca", "conteudo", "rd"],
        },
        leaseContractId: { type: "string" },
        expiringInDays: { type: "number" },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/locacao/insurance",
        query: {
          status: args.status as string | undefined,
          tipo: args.tipo as string | undefined,
          leaseContractId: args.leaseContractId as string | undefined,
          expiringInDays: args.expiringInDays ? String(args.expiringInDays) : undefined,
        },
      });
      return r.body;
    },
  },
  {
    name: "list_lease_inspections",
    description: "Lista vistorias de locação (Inspection). Filtro opcional por status.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string" } },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/locacao/inspections",
        query: args.status ? { status: args.status as string } : undefined,
      });
      return r.body;
    },
  },
  {
    name: "list_rent_charges",
    description:
      "Lista cobranças de aluguel (RentCharge). Filtros: leaseContractId, competencia (YYYY-MM), status.",
    inputSchema: {
      type: "object",
      properties: {
        leaseContractId: { type: "string" },
        competencia: { type: "string", description: "YYYY-MM" },
        status: { type: "string" },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/locacao/rent-charges",
        query: {
          leaseContractId: args.leaseContractId as string | undefined,
          competencia: args.competencia as string | undefined,
          status: args.status as string | undefined,
        },
      });
      return r.body;
    },
  },

  // ───────────── Locação — escrita (Max, scope locacao:rw) ─────────────
  {
    name: "upsert_insurer_analysis",
    description:
      "Registra/atualiza a análise de fiança de UMA seguradora pra um cliente de locação (InsurerAnalysis). Usar após consultar a seguradora via max-fianca. analysisId presente = atualiza (PATCH); ausente = cria (POST).",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        analysisId: { type: "string", description: "Presente = atualizar existente" },
        seguradora: { type: "string" },
        status: {
          type: "string",
          description: "pendente | aprovado | aprovado_com_ressalva | recusado | erro",
        },
        premioMensal: { type: "number" },
        externalRef: { type: "string" },
        resultJson: { type: "object", additionalProperties: true },
      },
      required: ["clientId", "seguradora"],
    },
    handler: async (args) => {
      const base = `/api/locacao/clients/${encodeURIComponent(args.clientId as string)}/insurer-analyses`;
      const body = {
        seguradora: args.seguradora,
        status: args.status,
        premioMensal: args.premioMensal,
        externalRef: args.externalRef,
        resultJson: args.resultJson,
      };
      const r = args.analysisId
        ? await callApi({
            method: "PATCH",
            path: base,
            body: { ...body, analysisId: args.analysisId },
          })
        : await callApi({ method: "POST", path: base, body });
      return r.body;
    },
  },
  {
    name: "create_lease_guarantee",
    description:
      "Cria garantia locatícia (Guarantee). tipo='seguro_fianca'/'garantia_digital'/'titulo_capitalizacao' exigem provider; tipo='fiador' exige objeto fiador; tipo='caucao' exige subtipo/valor em extra. Pra fiança consolidada SegurosJá+Alpop preferir record_insurance_quote (ramo fianca).",
    inputSchema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: [
            "fiador",
            "seguro_fianca",
            "titulo_capitalizacao",
            "caucao",
            "garantia_digital",
            "cessao_fiduciaria",
          ],
        },
        leaseContractId: { type: "string" },
        provider: { type: "string" },
        premioMensal: { type: "number" },
        coberturaMeses: { type: "number" },
        fiador: { type: "object", additionalProperties: true },
        extra: {
          type: "object",
          description: "Campos adicionais do tipo (valorTitulo, caucaoSubtipo...)",
          additionalProperties: true,
        },
      },
      required: ["tipo", "leaseContractId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: "/api/locacao/guarantees",
        body: {
          tipo: args.tipo,
          leaseContractId: args.leaseContractId,
          provider: args.provider,
          premioMensal: args.premioMensal,
          coberturaMeses: args.coberturaMeses,
          fiador: args.fiador,
          ...((args.extra as Record<string, unknown>) ?? {}),
        },
      });
      return r.body;
    },
  },
  {
    name: "update_lease_guarantee",
    description:
      "Atualiza garantia locatícia existente (status, provider, coberturaMeses, custoJson, dadosJson).",
    inputSchema: {
      type: "object",
      properties: {
        guaranteeId: { type: "string" },
        status: { type: "string" },
        provider: { type: "string" },
        coberturaMeses: { type: "number" },
        externalRef: { type: "string" },
        custoJson: { type: "object", additionalProperties: true },
        dadosJson: { type: "object", additionalProperties: true },
      },
      required: ["guaranteeId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "PATCH",
        path: `/api/locacao/guarantees/${encodeURIComponent(args.guaranteeId as string)}`,
        body: {
          status: args.status,
          provider: args.provider,
          coberturaMeses: args.coberturaMeses,
          externalRef: args.externalRef,
          custoJson: args.custoJson,
          dadosJson: args.dadosJson,
        },
      });
      return r.body;
    },
  },
  {
    name: "create_insurance_policy",
    description:
      "Cria apólice/cotação de seguro de locação (InsurancePolicy) direto. Pra cotação de incêndio vinda do max-fianca preferir record_insurance_quote (idempotente por externalRef).",
    inputSchema: {
      type: "object",
      properties: {
        leaseContractId: { type: "string" },
        tipo: {
          type: "string",
          enum: ["seguro_incendio", "seguro_fianca", "conteudo", "rd"],
        },
        seguradora: { type: "string" },
        apoliceNumero: { type: "string" },
        premioMensal: { type: "number" },
        vigenciaInicio: { type: "string", description: "ISO 8601 (obrigatório)" },
        vigenciaFim: { type: "string", description: "ISO 8601 (obrigatório, > início)" },
        responsavelPagamento: {
          type: "string",
          enum: ["imobiliaria", "locatario", "proprietario"],
        },
      },
      required: ["leaseContractId", "tipo", "seguradora", "vigenciaInicio", "vigenciaFim"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: "/api/locacao/insurance",
        body: {
          leaseContractId: args.leaseContractId,
          tipo: args.tipo,
          seguradora: args.seguradora,
          apoliceNumero: args.apoliceNumero,
          premioMensal: args.premioMensal,
          vigenciaInicio: args.vigenciaInicio,
          vigenciaFim: args.vigenciaFim,
          responsavelPagamento: args.responsavelPagamento,
        },
      });
      return r.body;
    },
  },
];
