import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { searchKnowledgeBase } from "@/lib/ai/knowledge-search";
import { AGENT_REGISTRY, isAgentKey } from "@/lib/ai/agents/registry";

/**
 * Debug endpoint — lets the user test the knowledge base search from /settings/knowledge-base
 * without invoking the full agent loop.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query : "";
  const category = typeof body.category === "string" ? body.category : undefined;
  const topK = typeof body.topK === "number" ? body.topK : 5;

  /**
   * Agente cujo escopo simular. Sem ele a busca roda com escopo ABERTO — que
   * era o comportamento até 2026-07-31 e tornava esta tela inútil justamente
   * para o que ela existe: o usuário restringia o Jurídico em /settings,
   * voltava aqui, e continuava vendo tudo. Só aceita agente que o runtime
   * honra; qualquer outro seria mentira de outro tipo.
   */
  const rawAgent: unknown = body.agentKey;
  const agentKey =
    typeof rawAgent === "string" &&
    isAgentKey(rawAgent) &&
    AGENT_REGISTRY[rawAgent].supports.ragScope
      ? rawAgent
      : undefined;

  if (!query) {
    return NextResponse.json({ error: "query obrigatória" }, { status: 400 });
  }

  const result = await searchKnowledgeBase({
    orgId: org.id,
    userId: session.user.id,
    agentKey,
    query,
    category,
    topK,
  });

  return NextResponse.json(result);
}
