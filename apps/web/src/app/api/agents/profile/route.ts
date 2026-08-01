import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { withApi } from "@/lib/api/with-api";
import { resolveUserOrgId } from "@/lib/security/org-scope";
import { getAgentBudgetStatus } from "@/lib/ai/budget";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import { composeSystemPrompt } from "@/lib/ai/agents/prompt-blocks";
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
 * Auth: Bearer com escopo `agents:r` (ou session, pra depuração pela UI).
 *
 * `enabled: false` responde **200**, não 403. É kill switch operacional: quem
 * chama precisa distinguir "desligado de propósito" (encerra o turn com uma
 * mensagem ao usuário) de "não consegui ler a configuração" (tenta de novo).
 * Um 403 confunde as duas coisas.
 */
export const GET = withApi(
  "GET /api/agents/profile",
  async (req: NextRequest) => {
    const ident = await authOrBearer(req);
    if (!ident) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasScope(ident, "agents:r")) {
      return NextResponse.json(
        { error: "Forbidden", reason: "missing scope agents:r" },
        { status: 403 }
      );
    }

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

    // Sem org não há perfil de tenant a resolver, e cair no nível de plataforma
    // devolveria uma configuração que NÃO é a de ninguém. Melhor recusar.
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

    const [profile, budget] = await Promise.all([
      resolveAgentProfile(agentKey, orgId),
      getAgentBudgetStatus(orgId, agentKey),
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
       * Pra o agente externo poder avisar antes de ser cortado. O corte em si é
       * responsabilidade de quem gasta: aqui não há turn a bloquear.
       */
      budget,
    });
  }
);
