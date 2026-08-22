import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withApi } from "@/lib/api/with-api";
import { getContractOrgId, getDealOrgId } from "@/lib/security/org-scope";
import { calcCostUsd, recordAIUsage } from "@/lib/ai/usage";
import { maxAgentRouteGate } from "@/lib/max/gate";
import {
  AGENT_REGISTRY,
  EXTERNAL_AGENT_KEYS,
  isExternalAgentKey,
} from "@/lib/ai/agents/registry";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

/**
 * Tetos de sanidade. Não são política de custo — são o que impede um cliente
 * externo de gravar um número absurdo numa tabela que alimenta o teto mensal por
 * agente e o teto por contrato.
 *
 * 500k é folgado sobre qualquer turn real (a janela de contexto dos modelos que
 * usamos é ~200k) e ainda assim contém o estrago: o valor anterior, 2M por
 * campo, deixava UMA request gravar ~US$ 73 e dez vezes o budget inteiro de um
 * contrato.
 */
const MAX_TOKENS_POR_TURN = 500_000;
const MAX_LATENCIA_MS = 600_000;

/**
 * Teto do custo REPORTADO por turn, pelo mesmo motivo dos tetos acima: este é
 * o único campo que entra na tabela de custo SEM passar pela tabela de preços,
 * então ele precisa da sua própria cerca.
 *
 * US$ 1,00 é ordem de grandeza absurda para um turn — os turns reais do Max
 * custam frações de centavo (US$ 0,0004 sem cache) — e ainda assim contém o
 * estrago bem abaixo do budget de um contrato.
 *
 * **Não é aplicado no zod, de propósito** — ver o comentário no ponto de uso.
 * Estourar o teto descarta o NÚMERO, não a linha.
 */
const MAX_CUSTO_USD_POR_TURN = 1;

const bodySchema = z.object({
  agentKey: z.string().min(1),
  provider: z
    .enum(["anthropic", "gemini", "voyage", "openrouter"])
    .default("anthropic"),
  model: z.string().min(1).max(128),
  promptTokens: z.number().int().min(0).max(MAX_TOKENS_POR_TURN),
  completionTokens: z.number().int().min(0).max(MAX_TOKENS_POR_TURN).optional(),
  cacheReadTokens: z.number().int().min(0).max(MAX_TOKENS_POR_TURN).optional(),
  cacheWriteTokens: z.number().int().min(0).max(MAX_TOKENS_POR_TURN).optional(),
  latencyMs: z.number().int().min(0).max(MAX_LATENCIA_MS),
  /**
   * Crédito REAL cobrado pelo provedor. Honrado só quando
   * `provider === "openrouter"` — ver a exceção no docblock do POST.
   *
   * `.nullable()` de propósito: o emissor manda `null` quando o provedor não
   * informou, e null tem que ser aceito como "não informado" em vez de virar
   * 400. Zero é aceito como valor legítimo no schema, mas o `recordAIUsage`
   * trata `0` como número medido — o emissor manda `null`, nunca `0`, quando
   * não sabe.
   */
  costUsd: z.number().min(0).finite().nullable().optional(),
  toolsUsed: z.array(z.string().max(64)).max(50).optional(),
  iterations: z.number().int().min(1).max(50).optional(),
  success: z.boolean().optional(),
  errorMessage: z.string().max(2000).optional(),
  // Dimensões analíticas. Validadas contra a org do token abaixo — sem isso um
  // token poderia carimbar consumo no contrato de OUTRA imobiliária e estourar
  // o budget dela (`assertContractBudget` soma por contractId).
  contractId: z.string().min(1).max(64).optional(),
  dealId: z.string().min(1).max(64).optional(),
});

/**
 * POST /api/agents/usage
 *
 * O agente externo reporta o custo do próprio turn, que entra em `AIUsage` com
 * `agentKey` e aparece em `/settings/ai-usage` junto com todo o resto. Sem este
 * caminho o painel mentiria por omissão: o gasto do agente que roda fora do
 * repo simplesmente não existiria no total.
 *
 * Auth: Bearer com escopo `agents:rw`, e **só** Bearer.
 *
 * Sessão é recusada de propósito. `hasScope` considera todo escopo presente pra
 * session-auth ("UI = poder total"), o que é razoável nas rotas em que o RBAC
 * decide depois — e perigoso aqui: esta é a única superfície em que um cliente
 * ESCREVE numa tabela de custo sem nenhum guard a jusante. Em produção o produto
 * é single-tenant compartilhado com signup aberto, então qualquer conta
 * recém-criada poderia, só com o cookie, inflar `AIUsage` até estourar o teto da
 * org e parar o chat de todo mundo. Reportar consumo é ato de máquina; quem
 * quiser inspecionar usa `GET /api/agents/profile` ou o painel.
 *
 * O que o cliente NÃO decide:
 *  - `operation` vem do registry (do contrário um token gravaria linhas como
 *    `specialist_editor` e sujaria o custo por operação);
 *  - `orgId`/`userId` vêm do token;
 *  - os tetos de sanidade por turn.
 *
 * ── A exceção do `costUsd`, e por que ela não fura a regra ───────────────
 *
 * Este bloco dizia, sem exceção: *"o custo em dólar é calculado aqui pela
 * tabela de preços — custo informado por quem gasta não é medição"*. A regra
 * continua valendo para tudo, MENOS para `provider === "openrouter"`, e a
 * diferença é de natureza: **aquele número não é auto-declarado pelo agente,
 * é o crédito que a fatura do provedor cobrou** (`usage.cost`, que vem inline
 * na resposta do OpenRouter). Quem "informa" é o OpenRouter; o Max só
 * transporta.
 *
 * Sem a exceção, o painel erra feio e para MAIS, não para menos. Medido em
 * 21/08 contra o `gpt-5.4-nano`: sem cache de prefixo a tabela acerta com erro
 * de 0,0%; num turn com 1792 de 1956 tokens vindos do cache, o custo real foi
 * US$ 0,00010614 contra US$ 0,00042870 da tabela — **superestimativa de
 * 304%**. Como `cached_tokens` não chegava até aqui, o tenant via uma conta
 * que não existe, e a otimização que mais economiza era invisível.
 *
 * De outro provider, `costUsd` é **ignorado em silêncio** (não é 400): o campo
 * é aditivo e um cliente antigo que o mande por engano não deve quebrar. O que
 * protege contra número absurdo é o teto de sanidade, igual ao dos tokens.
 */
export const POST = withApi("POST /api/agents/usage", async (req: NextRequest) => {
  const authed = await requireApiAuth(req, { scope: "agents:rw" });
  if (isAuthFailure(authed)) return authFailureResponse(authed);
  if (authed.ident.via !== "bearer") {
    return NextResponse.json(
      {
        error: "Forbidden",
        reason: "esta rota é máquina-a-máquina: use um token com agents:rw",
      },
      { status: 403 }
    );
  }
  const orgId = authed.org.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const body = parsed.data;

  if (!isExternalAgentKey(body.agentKey)) {
    return NextResponse.json(
      {
        error: "Bad Request",
        reason: "agentKey não é um agente externo",
        allowed: EXTERNAL_AGENT_KEYS,
      },
      { status: 400 }
    );
  }

  // Entitlement do tenant: org que não contratou o Max não move o custo dela.
  const denied = await maxAgentRouteGate({
    orgId,
    via: authed.ident.via,
    agentKey: body.agentKey,
  });
  if (denied) return denied;

  // Id de outra org é recusado, não silenciosamente descartado: quem reporta
  // precisa saber que a atribuição não aconteceu.
  if (body.contractId) {
    const dono = await getContractOrgId(body.contractId);
    if (dono !== orgId) {
      return NextResponse.json(
        { error: "Forbidden", reason: "contractId fora da organização do token" },
        { status: 403 }
      );
    }
  }
  if (body.dealId) {
    const dono = await getDealOrgId(body.dealId);
    if (dono !== orgId) {
      return NextResponse.json(
        { error: "Forbidden", reason: "dealId fora da organização do token" },
        { status: 403 }
      );
    }
  }

  /**
   * A exceção, num lugar só: fora do OpenRouter, `costUsd` é descartado e a
   * tabela de preços decide. Ignorar em silêncio (e não 400) é deliberado — o
   * campo é aditivo, e um cliente que o mande por engano não deve quebrar.
   */
  const doOpenRouter = body.provider === "openrouter" ? body.costUsd ?? null : null;
  if (body.costUsd != null && doOpenRouter === null) {
    console.warn(
      `[agents/usage] costUsd ignorado: só vale para openrouter (veio de ${body.provider})`
    );
  }

  /**
   * O teto de sanidade fica AQUI, e não no zod, e a diferença importa.
   *
   * No zod ele rejeitava a requisição INTEIRA com 400 — e aí a linha não era
   * gravada de jeito nenhum: nem tokens, nem latência, nem `contractId`. Duas
   * consequências, as duas contrárias ao propósito do teto:
   *
   *  · o teto existe para proteger o budget de um número absurdo, e sem a
   *    linha o budget passa a SUBcontar. Um turn caro de verdade sumia da
   *    conta em vez de entrar limitado;
   *  · contradizia o contrato prometido três parágrafos acima — um turn
   *    `anthropic` carregando `costUsd: 2.30` tomava 400, mesmo sendo um valor
   *    que seria descartado logo em seguida.
   *
   * Agora o número suspeito é DESCARTADO (não truncado — truncar gravaria um
   * valor inventado como se fosse medido) e a linha cai na estimativa, alto no
   * log. A medição se perde; a contabilidade, não.
   */
  const custoReportado =
    doOpenRouter !== null && doOpenRouter <= MAX_CUSTO_USD_POR_TURN ? doOpenRouter : null;
  if (doOpenRouter !== null && custoReportado === null) {
    console.error(
      `[agents/usage] costUsd ${doOpenRouter} acima do teto de US$ ${MAX_CUSTO_USD_POR_TURN} ` +
        `— descartado, a linha vai como estimativa (agente ${body.agentKey}, modelo ${body.model})`
    );
  }

  const operation = AGENT_REGISTRY[body.agentKey].operations[0];
  if (!operation) {
    // Agente externo sem operation no registry é erro de configuração nossa,
    // não do cliente — e gravar sem operation deixaria a linha fora de todo
    // filtro do painel.
    return NextResponse.json(
      { error: "Internal Server Error", reason: "agente externo sem operation" },
      { status: 500 }
    );
  }

  recordAIUsage({
    orgId,
    agentKey: body.agentKey,
    userId: authed.actor.effectiveUserId,
    contractId: body.contractId ?? null,
    dealId: body.dealId ?? null,
    provider: body.provider,
    model: body.model,
    operation,
    promptTokens: body.promptTokens,
    completionTokens: body.completionTokens,
    cacheReadTokens: body.cacheReadTokens,
    cacheWriteTokens: body.cacheWriteTokens,
    latencyMs: body.latencyMs,
    toolsUsed: body.toolsUsed,
    iterations: body.iterations,
    success: body.success,
    errorMessage: body.errorMessage,
    costUsd: custoReportado,
  });

  const estimatedCostUsd = calcCostUsd(
    body.model,
    body.promptTokens,
    body.completionTokens ?? 0,
    body.cacheReadTokens ?? 0,
    body.cacheWriteTokens ?? 0
  );
  const costUsd = custoReportado ?? estimatedCostUsd;

  // Era a única rota M2M de ESCRITA sem rastro no AuditLog — e é escrita numa
  // tabela de CUSTO que alimenta teto por agente. O rastro diz quem (token →
  // usuário efetivo) reportou quanto, quando.
  audit(extractAuditContextFromRequest(req, orgId, authed.actor.effectiveUserId), {
    action: "AGENT_USAGE_REPORTED",
    result: "SUCCESS",
    resourceType: "AIUsage",
    resource: body.agentKey,
    metadata: {
      model: body.model,
      totalTokens: body.promptTokens + (body.completionTokens ?? 0),
      costUsd,
      costSource: custoReportado !== null ? "reported" : "estimated",
      estimatedCostUsd,
    },
  }).catch(() => {});

  // 202: `recordAIUsage` é fire-and-forget por construção (observabilidade não
  // pode derrubar o fluxo de IA), então prometer "gravado" seria mentira.
  return NextResponse.json(
    {
      accepted: true,
      agentKey: body.agentKey,
      operation,
      orgId,
      /** O que de fato foi gravado — reportado quando houve, estimado quando não. */
      costUsd,
      costSource: custoReportado !== null ? "reported" : "estimated",
      /** A estimativa, SEMPRE, mesmo quando o reportado venceu: é o que deixa
       *  quem integra medir o tamanho do erro da tabela de preços sem
       *  precisar de acesso ao banco. */
      estimatedCostUsd,
      /**
       * `priced` continua sendo sobre a TABELA DE PREÇOS: false = modelo fora
       * de `lib/ai/usage.ts::PRICING`, não turn de graça.
       *
       * Deliberadamente NÃO passou a olhar `costUsd`. Um modelo `:free` do
       * OpenRouter reporta custo real **0**, e aí `costUsd > 0` diria
       * `priced: false` — que quem integra leria como "modelo fora da tabela".
       * Dois fatos diferentes não podem dividir a mesma flag; a procedência
       * quem responde é `costSource`.
       */
      priced: estimatedCostUsd > 0,
    },
    { status: 202 }
  );
});
