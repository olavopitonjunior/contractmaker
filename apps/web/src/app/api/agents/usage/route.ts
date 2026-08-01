import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { withApi } from "@/lib/api/with-api";
import { rateLimit } from "@/lib/security/ratelimit";
import {
  getContractOrgId,
  getDealOrgId,
  resolveUserOrgId,
} from "@/lib/security/org-scope";
import { calcCostUsd, recordAIUsage } from "@/lib/ai/usage";
import {
  AGENT_REGISTRY,
  EXTERNAL_AGENT_KEYS,
  isExternalAgentKey,
} from "@/lib/ai/agents/registry";

export const dynamic = "force-dynamic";

/**
 * Tetos de sanidade. Não são política de custo — são o que impede um cliente
 * externo de gravar um número absurdo numa tabela que alimenta o teto mensal por
 * agente e o teto por contrato. Um turn real fica ordens de grandeza abaixo.
 */
const MAX_TOKENS_POR_TURN = 2_000_000;
const MAX_LATENCIA_MS = 600_000;

const bodySchema = z.object({
  agentKey: z.string().min(1),
  provider: z.enum(["anthropic", "gemini", "voyage"]).default("anthropic"),
  model: z.string().min(1).max(128),
  promptTokens: z.number().int().min(0).max(MAX_TOKENS_POR_TURN),
  completionTokens: z.number().int().min(0).max(MAX_TOKENS_POR_TURN).optional(),
  cacheReadTokens: z.number().int().min(0).max(MAX_TOKENS_POR_TURN).optional(),
  cacheWriteTokens: z.number().int().min(0).max(MAX_TOKENS_POR_TURN).optional(),
  latencyMs: z.number().int().min(0).max(MAX_LATENCIA_MS),
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
 * Auth: Bearer com escopo `agents:rw`.
 *
 * O que o cliente NÃO decide:
 *  - `operation` vem do registry (do contrário um token gravaria linhas como
 *    `specialist_editor` e sujaria o custo por operação);
 *  - `orgId`/`userId` vêm do token;
 *  - o custo em dólar é calculado aqui pela tabela de preços — custo informado
 *    por quem gasta não é medição.
 */
export const POST = withApi("POST /api/agents/usage", async (req: NextRequest) => {
  const ident = await authOrBearer(req);
  if (!ident) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(ident, "agents:rw")) {
    return NextResponse.json(
      { error: "Forbidden", reason: "missing scope agents:rw" },
      { status: 403 }
    );
  }

  const rl = await rateLimit({
    identifier: `agents-usage:${ident.userId}`,
    limit: 120,
    window: "1 m",
  });
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too Many Requests", reason: "limite de 120 registros/min" },
      { status: 429 }
    );
  }

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

  const orgId = await resolveUserOrgId(ident.userId);
  if (!orgId) {
    return NextResponse.json(
      {
        error: "Forbidden",
        reason: "usuário do token não pertence a nenhuma organização",
      },
      { status: 403 }
    );
  }

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
    userId: ident.userId,
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
  });

  const estimatedCostUsd = calcCostUsd(
    body.model,
    body.promptTokens,
    body.completionTokens ?? 0,
    body.cacheReadTokens ?? 0,
    body.cacheWriteTokens ?? 0
  );

  // 202: `recordAIUsage` é fire-and-forget por construção (observabilidade não
  // pode derrubar o fluxo de IA), então prometer "gravado" seria mentira.
  return NextResponse.json(
    {
      accepted: true,
      agentKey: body.agentKey,
      operation,
      orgId,
      estimatedCostUsd,
      // 0 aqui significa modelo fora da tabela de preços (lib/ai/usage.ts::PRICING),
      // não turn de graça — quem integra precisa conseguir notar isso.
      priced: estimatedCostUsd > 0,
    },
    { status: 202 }
  );
});
