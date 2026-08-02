import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withApi } from "@/lib/api/with-api";
import { searchKnowledgeBase } from "@/lib/ai/knowledge-search";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import { assertAgentBudget, AgentBudgetExceededError } from "@/lib/ai/budget";
import {
  AGENT_REGISTRY,
  EXTERNAL_AGENT_KEYS,
  isExternalAgentKey,
} from "@/lib/ai/agents/registry";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  agentKey: z.string().min(1),
  query: z.string().min(1).max(2000),
  category: z.string().min(1).max(64).optional(),
  groupCode: z.string().regex(/^G[1-6]$/).optional(),
  topK: z.number().int().min(1).max(10).optional(),
});

/**
 * POST /api/agents/knowledge/search
 *
 * A base de conhecimento do tenant, para um agente que roda fora deste repo — o
 * Max responder "como funciona a esteira de locação?" no WhatsApp com o material
 * da imobiliária, e não com o que o modelo acha que sabe.
 *
 * Até aqui o RAG só existia dentro do loop de agente e no endpoint de debug de
 * `/settings/knowledge-base`, ambos session-only. Sem esta rota o Max teria duas
 * saídas ruins: credencial do banco da aplicação (o serviço dele deliberadamente
 * não tem) ou responder de cabeça.
 *
 * Auth: `requireApiAuth` com escopo `agents:r`, mesmo par da rota de perfil.
 * Vale o helper canônico e não `authOrBearer` cru — é ele que fixa
 * `subdomainHint: null` no caminho de máquina; sem isso o `Host` escolheria a
 * org de um dono de token que é membro de vários tenants, e a busca leria a base
 * do tenant errado. Sessão é aceita (é leitura, e ajuda a depurar pela UI).
 *
 * **O escopo é a razão de a rota exigir `agentKey`.** `searchKnowledgeBase`
 * repassa a chave, `ragScopeFor` resolve o `AgentProfile` e aplica categorias,
 * tags e `visibleToAgents`. Sem `agentKey` a busca roda ABERTA — o agente veria
 * a base inteira da org, incluindo o que o dono restringiu no console.
 */
export const POST = withApi(
  "POST /api/agents/knowledge/search",
  async (req: NextRequest) => {
    const authed = await requireApiAuth(req, { scope: "agents:r" });
    if (isAuthFailure(authed)) return authFailureResponse(authed);
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
        { error: "Bad Request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { agentKey, query, category, groupCode, topK } = parsed.data;

    // Mesma allowlist da rota de perfil: só agente que roda FORA daqui. Genérica,
    // esta rota deixaria um token consultar a base com o escopo de um
    // especialista interno — escopo que o tenant configurou para outro fim.
    if (!isExternalAgentKey(agentKey)) {
      return NextResponse.json(
        {
          error: "Bad Request",
          reason: "agentKey ausente ou não é um agente externo",
          allowed: EXTERNAL_AGENT_KEYS,
        },
        { status: 400 }
      );
    }

    /**
     * Kill switch: agente desligado no console não consulta. Aqui um 403 é
     * inequívoco, diferente do que vale em `GET /api/agents/profile` — lá
     * `enabled: false` responde 200 porque a rota É como o agente descobre que
     * está desligado, e um 403 se confundiria com "não consegui ler a
     * configuração". Quem chega aqui já leu o perfil; insistir é bug ou abuso.
     */
    const profile = await resolveAgentProfile(agentKey, orgId);
    if (!profile.enabled) {
      return NextResponse.json(
        {
          error: "AGENT_DISABLED",
          reason: `O agente "${AGENT_REGISTRY[agentKey].label}" está desligado para esta organização.`,
        },
        { status: 403 }
      );
    }

    // Consulta semântica gasta embedding (Voyage), que entra em AIUsage e conta
    // pro teto do agente. Sem este gate o teto seria contornável justamente pelo
    // caminho barato-mas-frequente: uma pergunta no WhatsApp = uma embedding.
    try {
      await assertAgentBudget(orgId, agentKey);
    } catch (err) {
      if (err instanceof AgentBudgetExceededError) {
        return NextResponse.json(
          { error: "AGENT_BUDGET_EXCEEDED", reason: err.message },
          { status: 402 }
        );
      }
      throw err;
    }

    const result = await searchKnowledgeBase({
      orgId,
      userId: authed.actor.effectiveUserId,
      agentKey,
      query,
      category,
      groupCode,
      topK,
    });

    return NextResponse.json(result);
  }
);
