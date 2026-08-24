import { NextRequest, NextResponse } from "next/server";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withApi } from "@/lib/api/with-api";
import { getAgentBudgetStatus } from "@/lib/ai/budget";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import { composeSystemPrompt } from "@/lib/ai/agents/prompt-blocks";
import { maxAgentRouteGate } from "@/lib/max/gate";
import { getMaxPolicy, POLITICA_VAZIA } from "@/lib/max/policy";
import {
  AGENT_REGISTRY,
  EXTERNAL_AGENT_KEYS,
  isExternalAgentKey,
} from "@/lib/ai/agents/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/profile?agentKey=max
 *
 * Onde um agente que roda fora deste repo (o Max, LangGraph da Sessão C) lê sua
 * própria configuração: modelo, contingência, instruções e escopo de RAG — o
 * mesmo `AgentProfile` que o console de agentes edita, resolvido na cadeia
 * org → plataforma → hardcoded.
 *
 * Antes disso a persona do Max só existiria fora do git: nada versionado, nada
 * auditável, e nenhuma forma de desligá-lo sem deploy.
 *
 * Auth: `requireApiAuth` com escopo `agents:r` — Bearer, ou session pra
 * depuração pela UI. Vale o helper canônico em vez de `authOrBearer` cru: ele
 * traz o rate limit por token+scope e, sobretudo, a resolução de org do caminho
 * de MÁQUINA (`subdomainHint: null` quando é bearer). Sem esse pin, o `Host` da
 * request escolheria a org de um dono de token que é membro de várias — e a
 * persona devolvida sairia do tenant errado.
 *
 * `instructions.platform` do agente externo fica legível por qualquer membro do
 * tenant, diferente do prompt dos especialistas internos (que a allowlist
 * abaixo bloqueia). É consequência do desenho — `composed` precisa conter o
 * texto —, então nada de segredo operacional aqui dentro.
 *
 * `enabled: false` responde **200**, não 403. É kill switch operacional: quem
 * chama precisa distinguir "desligado de propósito" (encerra o turn com uma
 * mensagem ao usuário) de "não consegui ler a configuração" (tenta de novo).
 * Um 403 confunde as duas coisas.
 */
export const GET = withApi(
  "GET /api/agents/profile",
  async (req: NextRequest) => {
    // `requireOrg` default (true): sem org não há perfil de tenant a resolver, e
    // cair no nível de plataforma devolveria uma configuração que não é a de
    // ninguém.
    const authed = await requireApiAuth(req, { scope: "agents:r" });
    if (isAuthFailure(authed)) return authFailureResponse(authed);
    const orgId = authed.org.id;

    const agentKey = req.nextUrl.searchParams.get("agentKey") ?? "";
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

    // Entitlement do tenant. Ver `maxAgentRouteGate` para por que 403 aqui e 200
    // no `enabled: false` logo abaixo — são perguntas diferentes.
    const denied = await maxAgentRouteGate({
      orgId,
      via: authed.ident.via,
      agentKey,
    });
    if (denied) return denied;

    /**
     * A política de capabilities entra NESTA chamada, e não numa rota própria.
     *
     * O `gate` do Max já faz este GET uma vez por turn para ler `enabled` —
     * uma rota separada custaria um segundo round-trip por mensagem, e o
     * orçamento de tempo do turn vive dentro de uma function de 60 s que já
     * gastou identidade, transcrição e RAG.
     *
     * Só para o `max`: os outros agentes externos não têm política, e devolver
     * a forma vazia para eles sugeriria uma configuração que não existe.
     */
    const [profile, budget, maxPolicy] = await Promise.all([
      resolveAgentProfile(agentKey, orgId),
      getAgentBudgetStatus(orgId, agentKey),
      agentKey === "max" ? getMaxPolicy(orgId) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      agentKey,
      label: AGENT_REGISTRY[agentKey].label,
      orgId,
      enabled: profile.enabled,
      model: profile.model,
      modelSource: profile.modelSource,
      fallbackModel: profile.fallbackModel,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      instructions: {
        platform: profile.platformInstructions,
        tenant: profile.tenantInstructions,
        /**
         * Os dois blocos já compostos e cercados, prontos pra concatenar ao
         * prompt-base do agente externo. O texto do tenant PRECISA entrar dentro
         * de `<instrucoes_da_imobiliaria>` — é dado de terceiro, não autoridade
         * capaz de redefinir o agente. Entregar composto tira do outro runtime a
         * chance de esquecer a cerca.
         */
        composed: composeSystemPrompt("", profile),
      },
      ragScope: profile.ragScope,
      /**
       * Teto do que o agente pode OFERECER a cada sujeito. **Nunca alarga**: o
       * que volta de fato continua sendo decidido pelo RBAC no `where` das
       * queries, onde esta política não alcança.
       *
       * Org sem linha devolve a forma VAZIA, não `null` — ausência de política
       * e política vazia significam a mesma coisa (nenhuma capability,
       * fail-closed), e dar duas formas para um significado só obrigaria o
       * outro lado a tratar dois casos idênticos.
       */
      maxPolicy: agentKey === "max" ? (maxPolicy ?? POLITICA_VAZIA) : undefined,
      /**
       * Pra o agente externo poder avisar antes de ser cortado. O corte em si é
       * responsabilidade de quem gasta: aqui não há turn a bloquear.
       */
      budget,
    });
  }
);
