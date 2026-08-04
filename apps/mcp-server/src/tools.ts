import { spawn } from "node:child_process";
import { callApi, callBridge, logProactiveOutbound } from "./index.js";
import { validateInWindow } from "./cron-window.js";
import { explainApiError } from "./api-error.js";

/**
 * Reconhece JID de grupo. Cobre três formatos, de propósito:
 *
 * 1. `<digitos>-group` — a convenção da bridge, o único que aparece na prática.
 * 2. `<digitos>-<digitos>-group` — JID legado do WhatsApp, onde o id do grupo é
 *    `<criador>-<timestamp>`; o `\d+-group` puro não pegava o hífen interno.
 * 3. `...@g.us` — sufixo nativo do WhatsApp, case-insensitive.
 *
 * Só o (1) é esperado aqui; (2) e (3) são cinto-e-suspensórios pro dia em que a
 * bridge mudar de formato ou um id vier cru da API do WhatsApp. Sem piso de
 * dígitos: o sufixo já é o sinal, e telefone de pessoa nunca termina em `-group`
 * nem em `@g.us`. Fail-closed é barato — recusar um destino que não era grupo dá
 * erro visível, aceitar dá mensagem proativa em grupo, exatamente o que a trava
 * abaixo existe pra impedir.
 */
function isGroupJid(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  return /@g\.us$/i.test(s) || /^\d{1,25}(?:-\d{1,25})?-group$/.test(s);
}

/**
 * Envio proativo pra grupo é proibido desde 2026-07-25 (ver
 * docs/newton-escopo-grupos.md). A persona já diz isso, mas prompt é instrução,
 * não garantia — e o modelo ativo é nano-tier. Aqui a trava é determinística.
 *
 * Isto NÃO afeta o Newton responder num grupo quando é mencionado: essa resposta
 * volta pelo fluxo natural do webhook na bridge, não por estas tools, que
 * existem justamente pra mandar mensagem FORA daquele fluxo.
 */
function assertNotGroupTarget(raw: unknown, tool: string): void {
  if (isGroupJid(raw)) {
    throw new Error(
      `${tool}: destino de grupo não é permitido. Envio proativo pra grupo foi ` +
        `desligado — em grupo o Newton só responde quando mencionado, e a única ` +
        `ação de escrita liberada é create_form. Pra falar com uma pessoa, use o ` +
        `telefone E.164 dela.`
    );
  }
}

/**
 * Normaliza o destino do WhatsApp para E.164 sem '+'.
 *
 * A descrição da tool exige "5511987654321", mas **não se pode confiar no
 * modelo pra isso**: verificado em produção (2026-07-25) que o agente recebeu
 * a instrução com `5511999063228` e ainda assim chamou a tool com
 * `11999063228`, sem o 55. A mensagem não chegou.
 *
 * E o modo de falha é silencioso em duas camadas: a bridge devolve o erro no
 * CORPO com HTTP 200, e quem chama registra "enviado". Por isso a trava é
 * aqui, determinística, e não no prompt.
 *
 * JID de grupo **lança**: não existe forma normalizada de um grupo pra esta
 * função devolver, e deixar passar intacto (como antes) sugeria que grupo é
 * destino válido. Os handlers já chamam `assertNotGroupTarget` antes, então este
 * ramo é redundante hoje — de propósito, pra que um caller futuro que esqueça o
 * assert falhe em vez de mandar mensagem pro grupo.
 *
 * Número que já parece E.164 internacional passa — normalizar só resolve o caso
 * BR sem DDI, que é o observado.
 */
function normalizeWhatsappTo(raw: unknown): string {
  const s = String(raw ?? "").trim();
  assertNotGroupTarget(s, "normalizeWhatsappTo");
  const d = s.replace(/\D/g, "");
  // 10-11 dígitos = BR sem DDI (fixo ou celular com 9º) → prefixa 55.
  if (d.length === 10 || d.length === 11) return `55${d}`;
  // 12-13 começando com 55 = já normalizado.
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  // Qualquer outra coisa passa como veio — não bloqueia internacional nem
  // formato que a bridge saiba tratar.
  return d || s;
}

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
    name: "list_my_notifications",
    description:
      "Lista os avisos do sistema do usuário (formulário concluído, contrato assinado, certidão travada, cobrança paga...). Use quando perguntarem 'tenho algo pendente?', 'o que aconteceu hoje?' ou 'alguma novidade?'.",
    inputSchema: {
      type: "object",
      properties: {
        unread: {
          type: "boolean",
          description: "Só os não lidos. Default: todos.",
        },
        limit: {
          type: "number",
          description: "Máximo de avisos (1-50). Default: 20.",
        },
      },
    },
    handler: async (args) => {
      const query: Record<string, string> = {};
      if (args.unread === true) query.unread = "1";
      if (typeof args.limit === "number") query.limit = String(args.limit);
      const r = await callApi({
        method: "GET",
        path: "/api/me/notifications",
        query: Object.keys(query).length > 0 ? query : undefined,
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
      "Abre um NEGÓCIO: cria um SalesForm (schema compra_venda_v1) + um Deal no primeiro stage do pipeline, e devolve um link de formulário pro cliente PREENCHER DADOS. Retorna { id, token, url, dealId }. Idempotente via idempotencyKey. **NÃO é proposta.** Se pediram proposta, oferta, contraproposta ou 'mandar a proposta pro proprietário/comprador', a tool é `create_proposal` (e depois `send_proposal`) — esta aqui não gera documento nenhum pra ninguém assinar.",
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
      "Envia mensagem WhatsApp via Meta Cloud bridge (whatsapp-bridge.ia.br). Use quando quiser proativamente mandar mensagem fora do fluxo de resposta natural ao webhook (ex: avisar cliente que documento foi recebido, lembrar prazo). SÓ DM: 'to' é telefone E.164 sem '+' ('5511987654321'). JID de grupo é **rejeitado pelo servidor** (erro), não só desaconselhado — envio proativo pra grupo foi desligado. Nunca use pra cobrar informação de ninguém: quem persegue documento/dado pendente é uma pessoa, no sistema. Body até 4096 chars. Opcional replyToMessageId pra responder uma mensagem específica em contexto. Retorna { messages: [{id}] } com wamid.",
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
      assertNotGroupTarget(args.to, "whatsapp_send");
      const to = normalizeWhatsappTo(args.to);
      const body: Record<string, unknown> = {
        to,
        body: args.body,
      };
      if (args.replyToMessageId) {
        body.context = { message_id: args.replyToMessageId };
      }
      const r = await callBridge({ path: "/api/send", body });
      // F2: loga o envio proativo no histórico do DM do destinatário (best-effort,
      // só em envio bem-sucedido) pra que a resposta dele tenha contexto no /run.
      if (r.status >= 200 && r.status < 300) {
        await logProactiveOutbound({ to, content: String(args.body) });
      }
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
      "SÓ DM: JID de grupo é rejeitado pelo servidor (erro), e não se agenda " +
      "re-cobrança de informação pendente — nem uma vez, nem 'só um lembrete'. " +
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
          description:
            "Phone E.164 sem '+' (WA) ou chatId numérico (Telegram). JID de grupo é rejeitado.",
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

      assertNotGroupTarget(to, "schedule_proactive_message");

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

  // ───────────── Newton Requests (pendências registradas no negócio) ─────────────
  // Desde 2026-07-25 isto é um REGISTRO INTERNO da negociadora, não uma fila de
  // cobrança. O cron de re-cobrança (/api/cron/newton-requests/sweep) foi removido
  // e criar pendência não dispara turn nenhum no Newton — ninguém é cutucado.
  // Newton só LÊ essas rows (pra saber o que falta quando alguém pergunta) e pode
  // registrar andamento. Não sai atrás da informação, não manda whatsapp_send por
  // conta própria e não agenda lembrete. Quem persegue o dado é uma pessoa.
  {
    name: "list_newton_requests",
    description:
      "Lista pendências que a negociadora registrou num Deal (registro interno — NÃO é fila de cobrança). " +
      "Use pra consultar o que falta num negócio: quando alguém pergunta, ou ao receber resposta de um " +
      "contato/grupo (filtra por targetRef=telefone ou groupId pra achar a pendência que aquela resposta fecha). " +
      "Ler isto NÃO autoriza sair cobrando quem quer que seja. " +
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
      "Atualiza o andamento de uma pendência (write). action: 'chasing' (legado — só use se o próprio " +
      "user pediu que você cobrasse alguém em DM; não cobre por iniciativa própria), 'awaiting' " +
      "(aguardando resposta), 'fulfilled' (info chegou — passe resolutionNote; o backend avisa a " +
      "negociadora in-app e fecha), 'note' (só registra evento). O fechamento já notifica a negociadora " +
      "no sistema — não mande DM avisando por conta própria.",
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
      "Descobre qual grupo de WhatsApp está vinculado a um Deal (read). Use pra saber a qual negócio " +
      "um grupo pertence antes de responder nele — não pra iniciar conversa: envio proativo pra grupo " +
      "está desligado. " +
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

  // ───────────── Pipeline twins (Bearer) ─────────────
  {
    name: "mark_deal_lost",
    description:
      "Move deal pra 'Negócio perdido' (terminal alternativo) com motivo. Reversível via reopen_deal — sem HITL.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        reason: { type: "string", minLength: 3, maxLength: 500 },
        category: {
          type: "string",
          enum: [
            "desistencia",
            "imovel_vendido",
            "financiamento_negado",
            "imovel_alugado",
            "garantia_recusada",
            "credito_reprovado",
            "outro",
          ],
        },
      },
      required: ["dealId", "reason"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${encodeURIComponent(args.dealId as string)}/mark-lost`,
        body: { reason: args.reason, category: args.category },
      });
      return r.body;
    },
  },
  {
    name: "reopen_deal",
    description:
      "Reabre deal em 'Negócio perdido', restaurando a stage anterior (via histórico de audit; fallback por tipo de pipeline).",
    inputSchema: {
      type: "object",
      properties: { dealId: { type: "string" } },
      required: ["dealId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${encodeURIComponent(args.dealId as string)}/reopen`,
        body: {},
      });
      return r.body;
    },
  },
  {
    name: "archive_deal",
    description:
      "Arquiva (ou desarquiva com archived=false) um deal — some do kanban sem apagar nada. Idempotente e reversível.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        archived: {
          type: "boolean",
          description: "true arquiva (default), false desarquiva",
        },
      },
      required: ["dealId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${encodeURIComponent(args.dealId as string)}/archive`,
        body: { archived: args.archived },
      });
      return r.body;
    },
  },
  {
    name: "generate_deal_contract",
    description:
      "Gera o contrato do deal (Handlebars → Google Doc; locação usa gerador próprio). Cria rascunho deletável — a APROVAÇÃO do contrato é que passa por HITL (approve_contract).",
    inputSchema: {
      type: "object",
      properties: { dealId: { type: "string" } },
      required: ["dealId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/deals/${encodeURIComponent(args.dealId as string)}/generate-contract`,
        body: {},
      });
      return r.body;
    },
  },

  // ───────────── Certidões (status) ─────────────
  {
    name: "list_deal_certidoes",
    description:
      "Lista os CertidaoJobs de um deal (status da batch disparada via request_certidao). Filtro opcional por batchId.",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        batchId: { type: "string" },
      },
      required: ["dealId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/deals/${encodeURIComponent(args.dealId as string)}/certidoes`,
        query: args.batchId ? { batchId: args.batchId as string } : undefined,
      });
      return r.body;
    },
  },
  {
    name: "get_certidao_job",
    description:
      "Status de UM CertidaoJob (endpoint, status, resultCode, retries, portalUrl, anexo). Usar pra acompanhar jobs two-step (awaiting_portal).",
    inputSchema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        jobId: { type: "string" },
      },
      required: ["dealId", "jobId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/deals/${encodeURIComponent(args.dealId as string)}/certidoes/${encodeURIComponent(args.jobId as string)}`,
      });
      return r.body;
    },
  },

  // ───────────── Propostas ─────────────
  {
    name: "list_proposals",
    description:
      "**A tool pra consultar PROPOSTAS do sistema** — 'quais propostas eu tenho', 'como está a proposta da Patrícia', 'a última que mandei'. Escopo RBAC: corretor vê só as próprias/atribuídas. Filtros opcionais por status e kind. Não confundir com `nc_propostas`/`prop_*`, que são a ficha de acompanhamento do grupo Negócios NC e não enxergam o que existe no ImobPro.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "rascunho | aguardando_aprovacao | enviada | aguardando_vendedor | aceita | recusada | expirada | cancelada | convertida | falha_envio",
        },
        kind: { type: "string", enum: ["venda", "locacao"] },
      },
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: "/api/proposals",
        query: {
          status: args.status as string | undefined,
          kind: args.kind as string | undefined,
        },
      });
      return r.body;
    },
  },
  {
    name: "get_proposal",
    description: "Detalhe completo de uma proposta (dataJson, signers, eventos).",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}`,
      });
      return r.body;
    },
  },
  {
    name: "get_proposal_status",
    description:
      "Leitura rápida do estado atual da proposta (status + assinaturas). Barata — usar pra polling em vez de get_proposal.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "GET",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/status`,
      });
      return r.body;
    },
  },
  {
    name: "create_proposal",
    description:
      "**A tool de PROPOSTA.** Use sempre que pedirem proposta, oferta ou contraproposta de compra/locação de um imóvel — inclusive 'envie uma proposta': cria-se aqui em rascunho e só então `send_proposal` manda pra assinatura. NÃO use `create_form` pra isso: aquilo abre negócio e pede dados, não gera documento assinável. Também não confundir com as tools `prop_*`, que são a ficha de acompanhamento do grupo e não criam nada no sistema. schemaType decide venda (compra_venda_v1) ou locação (locacao_residencial_v1 | locacao_comercial_v1).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        schemaType: {
          type: "string",
          enum: ["compra_venda_v1", "locacao_residencial_v1", "locacao_comercial_v1"],
        },
        dataJson: {
          type: "object",
          description: "Campos da proposta (livre, validado pelo schema do form)",
        },
        validUntil: {
          type: "string",
          description:
            "ISO 8601 em UTC (terminando em Z). OPCIONAL — omita: sem prazo informado a proposta vale 7 dias. Não pergunte a validade ao usuário.",
        },
        signers: {
          type: "array",
          description:
            "Pessoas que assinam. `role` é OBRIGATÓRIO em cada uma: quem faz a oferta é `proponente`, o dono do imóvel é `vendedor`.",
          items: {
            type: "object",
            properties: {
              role: {
                type: "string",
                enum: ["proponente", "vendedor", "conjuge", "testemunha"],
              },
              name: { type: "string" },
              email: { type: "string" },
              cpf: { type: "string", description: "Só dígitos ou formatado" },
              phone: { type: "string" },
              notifyChannel: {
                type: "string",
                enum: ["email", "whatsapp", "sms"],
                description:
                  "Por onde avisar. Default 'email' — para Aceite por WhatsApp, mande 'whatsapp' com o telefone preenchido.",
              },
            },
            required: ["role", "name"],
          },
        },
        propertyId: { type: "string", description: "Imóvel do cadastro, opcional" },
        comissaoIncluida: {
          type: "boolean",
          description: "Inclui a comissão no corpo da proposta",
        },
        hiddenPaths: {
          type: "array",
          description:
            "Campos a esconder da via do proprietário (ex.: comissão). Não-vazio faz a 2ª via sair reduzida.",
          items: { type: "string" },
        },
      },
      required: ["title", "schemaType"],
    },
    handler: async (args) => {
      // A rota exige ISO-8601 estrito em UTC; data com offset (-03:00) ou só
      // "AAAA-MM-DD" reprovaria no Zod. Normaliza o que dá pra normalizar e
      // deixa o resto seguir, pra falha virar mensagem traduzida e não crash.
      let validUntil = args.validUntil as string | undefined;
      if (typeof validUntil === "string") {
        const d = new Date(validUntil);
        if (!Number.isNaN(d.getTime())) validUntil = d.toISOString();
      }
      const r = await callApi({
        method: "POST",
        path: "/api/proposals",
        body: {
          title: args.title,
          schemaType: args.schemaType,
          dataJson: args.dataJson ?? {},
          validUntil,
          signers: args.signers,
          propertyId: args.propertyId,
          comissaoIncluida: args.comissaoIncluida,
          hiddenPaths: args.hiddenPaths,
        },
      });
      return explainApiError(r) ?? r.body;
    },
  },
  {
    name: "send_proposal",
    description:
      "Envia uma proposta JÁ CRIADA pra assinatura (envelope ClickSign) ou Aceite WhatsApp. Exige o `proposalId` devolvido por `create_proposal` — quando pedirem 'envie uma proposta' que ainda não existe, chame `create_proposal` primeiro e use o id DELA (não o id de outra coisa que a API tenha devolvido). Executa na hora: quem pediu já autorizou, não peça uma segunda confirmação. Gasta orçamento ClickSign e a mensagem chega de verdade ao destinatário, então confira os dados ANTES de chamar — não depois.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        idempotencyKey: { type: "string", description: "UUID v4" },
      },
      required: ["proposalId", "idempotencyKey"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/send`,
        body: {},
        idempotencyKey: args.idempotencyKey as string,
      });
      return r.body;
    },
  },
  {
    name: "send_proposal_vendedor",
    description:
      "Dispara a 2ª via (envelope do vendedor/proprietário) de proposta em `aguardando_vendedor`. Executa na hora, sem segunda confirmação. Gasta orçamento ClickSign.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        idempotencyKey: { type: "string", description: "UUID v4" },
      },
      required: ["proposalId", "idempotencyKey"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/send-vendedor`,
        body: {},
        idempotencyKey: args.idempotencyKey as string,
      });
      return r.body;
    },
  },
  {
    name: "convert_proposal",
    description:
      "Converte proposta aceita em Deal + SalesForm. **Cria ActionIntent** que precisa de aprovação humana. allowUnsigned exige unsignedReason (audit).",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        allowUnsigned: {
          type: "boolean",
          description: "Converter sem assinatura concluída (exige unsignedReason)",
        },
        unsignedReason: { type: "string" },
        idempotencyKey: { type: "string", description: "UUID v4" },
      },
      required: ["proposalId", "idempotencyKey"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/convert`,
        body: {
          allowUnsigned: args.allowUnsigned,
          unsignedReason: args.unsignedReason,
        },
        idempotencyKey: args.idempotencyKey as string,
      });
      return r.body;
    },
  },
  {
    name: "cancel_proposal",
    description:
      "Cancela a proposta inteira. Executa na hora quando o corretor pede. IRREVERSÍVEL: destrói os envelopes ClickSign em curso e reenviar gasta orçamento de novo — por isso não é o remédio pra contato errado (aí é `update_proposal_signer` + `resend_proposal_signer`) nem pra dado errado (aí é `update_proposal`). Use quando o negócio caiu ou a proposta não deve mais existir.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        reason: { type: "string", minLength: 3, maxLength: 500 },
        idempotencyKey: { type: "string", description: "UUID v4" },
      },
      required: ["proposalId", "reason", "idempotencyKey"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/cancel`,
        body: { reason: args.reason },
        idempotencyKey: args.idempotencyKey as string,
      });
      return r.body;
    },
  },
  {
    name: "remind_proposal",
    description:
      "Reenvia a notificação de assinatura aos signatários pendentes da proposta. Barato, rate-limited — sem HITL.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        sourceKind: {
          type: "string",
          description: "Opcional: lembra só signatários desse sourceKind",
        },
      },
      required: ["proposalId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/remind`,
        body: args.sourceKind ? { sourceKind: args.sourceKind } : {},
      });
      return r.body;
    },
  },
  {
    name: "assign_proposal",
    description:
      "Define/troca o responsável pela proposta (responsibleUserId OU responsibleName pra nome avulso) ou limpa com clear=true.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        responsibleUserId: { type: "string" },
        responsibleName: {
          type: "string",
          description: "Nome avulso (mutuamente exclusivo com responsibleUserId)",
        },
        clear: { type: "boolean" },
      },
      required: ["proposalId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "PATCH",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/assignee`,
        body: {
          responsibleUserId: args.responsibleUserId,
          responsibleName: args.responsibleName,
          clear: args.clear,
        },
      });
      return r.body;
    },
  },
  {
    name: "sync_proposal",
    description:
      "Reconcilia os envelopes da proposta contra a ClickSign (status de assinaturas). Usar quando o status parece defasado.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/sync`,
        body: {},
      });
      return r.body;
    },
  },
  {
    name: "update_proposal",
    description:
      "Corrige uma proposta JÁ CRIADA (título, dados, validade). Use isto em vez de criar outra quando algo saiu errado — duas propostas do mesmo negócio confundem todo mundo. Para trocar o contato de quem assina, é `update_proposal_signer`.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        title: { type: "string" },
        dataJson: { type: "object", description: "Substitui os dados da proposta" },
        validUntil: { type: "string", description: "ISO 8601 em UTC (terminando em Z)" },
        comissaoIncluida: { type: "boolean" },
      },
      required: ["proposalId"],
    },
    handler: async (args) => {
      const body: Record<string, unknown> = {};
      if (args.title !== undefined) body.title = args.title;
      if (args.dataJson !== undefined) body.dataJson = args.dataJson;
      if (args.comissaoIncluida !== undefined) body.comissaoIncluida = args.comissaoIncluida;
      if (typeof args.validUntil === "string") {
        const d = new Date(args.validUntil);
        body.validUntil = Number.isNaN(d.getTime()) ? args.validUntil : d.toISOString();
      }
      const r = await callApi({
        method: "PATCH",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}`,
        body,
      });
      return explainApiError(r) ?? r.body;
    },
  },
  {
    name: "update_proposal_signer",
    description:
      "Corrige o CONTATO de quem assina (telefone, e-mail, nome, CPF) numa proposta já enviada — o caso clássico é 'mandei pro número errado'. Altera também na ClickSign, então o link passa a valer pro contato novo. Só funciona enquanto a pessoa não assinou. Depois de corrigir, chame `resend_proposal_signer` pra avisar o contato certo. NÃO cancele nem crie outra proposta por causa de telefone errado. O `signerId` vem de `get_proposal`.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        signerId: { type: "string", description: "id do signatário, vindo de get_proposal" },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string", description: "Telefone do signatário, com DDD" },
        documentation: { type: "string", description: "CPF" },
      },
      required: ["proposalId", "signerId"],
    },
    handler: async (args) => {
      const body: Record<string, unknown> = {};
      for (const k of ["name", "email", "phone", "documentation"] as const) {
        if (args[k] !== undefined) body[k] = args[k];
      }
      const r = await callApi({
        method: "PATCH",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/signers/${encodeURIComponent(args.signerId as string)}`,
        body,
      });
      return explainApiError(r) ?? r.body;
    },
  },
  {
    name: "resend_proposal_signer",
    description:
      "Reenvia o convite de assinatura pra UM signatário — depois de corrigir o contato, ou quando a pessoa diz que não recebeu. Não cria proposta nova.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        signerId: { type: "string" },
      },
      required: ["proposalId", "signerId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "POST",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/signers/${encodeURIComponent(args.signerId as string)}/resend`,
        body: {},
      });
      return explainApiError(r) ?? r.body;
    },
  },
  {
    name: "remove_proposal_signer",
    description:
      "Tira UM signatário da proposta (pessoa errada foi incluída), enquanto ela não assinou. Não cancela a proposta inteira — pra isso é `cancel_proposal`.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        signerId: { type: "string" },
      },
      required: ["proposalId", "signerId"],
    },
    handler: async (args) => {
      const r = await callApi({
        method: "DELETE",
        path: `/api/proposals/${encodeURIComponent(args.proposalId as string)}/signers/${encodeURIComponent(args.signerId as string)}`,
      });
      return explainApiError(r) ?? r.body;
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
