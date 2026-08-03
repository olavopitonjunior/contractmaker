import { executeToolHandler } from "@/lib/ai/tool-handlers";
import type { AgentContext } from "@/lib/ai/types";
import type { AgentKey } from "@/lib/ai/agents/registry";

/**
 * Busca na base de conhecimento fora do loop de agente.
 *
 * Dois consumidores, mesma necessidade: o "Testar RAG" de
 * `/settings/knowledge-base` (sessão) e a rota M2M `/api/agents/knowledge/search`
 * (o Max, que roda fora deste repo). Nenhum dos dois tem um contrato aberto, e
 * `query_knowledge_base` só lê `orgId` e `agentKey` do contexto — daí o shim.
 *
 * Por que passar pelo `executeToolHandler` em vez de extrair a consulta: o
 * handler carrega o pgvector com escopo (`knowledgeScopeSql`), o piso de
 * similaridade com `lowConfidence`, o fallback ILIKE quando não há Voyage e a
 * observabilidade de degradação. Duplicar isso pra economizar um shim de dez
 * linhas criaria dois RAGs que divergem no primeiro ajuste de recall.
 *
 * `agentKey` é o que dá escopo à busca: `ragScopeFor` resolve o `AgentProfile`
 * e aplica categorias, tags e `visibleToAgents`. Sem ele a busca roda ABERTA —
 * um agente veria a base inteira do tenant.
 */
export interface KnowledgeSearchParams {
  orgId: string;
  userId: string;
  agentKey?: AgentKey;
  query: string;
  category?: string;
  groupCode?: string;
  topK?: number;
}

export async function searchKnowledgeBase(
  p: KnowledgeSearchParams
): Promise<Record<string, unknown>> {
  const context: AgentContext = {
    contractId: "",
    userId: p.userId,
    orgId: p.orgId,
    agentKey: p.agentKey,
    htmlContent: "",
    dataJson: {},
    templateModalidade: "",
    templateName: "",
    activeClauses: [],
  };

  return executeToolHandler(
    "query_knowledge_base",
    {
      query: p.query,
      ...(p.category ? { category: p.category } : {}),
      ...(p.groupCode ? { groupCode: p.groupCode } : {}),
      ...(p.topK ? { topK: p.topK } : {}),
    },
    context
  );
}
