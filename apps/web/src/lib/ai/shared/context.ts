/**
 * `loadContext` — busca contrato + cláusulas ativas + html vivo (do Drive
 * quando GDoc). Compartilhado entre agent.ts legacy e o graph multi-agente
 * (orchestrator/loadContext node).
 */

import { prisma } from "@/lib/db/prisma";
import type { AgentContext } from "../types";

export async function loadContext(contractId: string, orgId: string): Promise<AgentContext> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      template: true,
      deal: { select: { kind: true } },
      clauses: {
        where: { isActive: true },
        include: {
          knowledgeItem: {
            select: { id: true, title: true, subcategory: true, category: true },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });

  // Quando o contrato é Google Doc, o doc é a fonte de verdade do texto.
  // Texto vivo via Drive export (read-only tools como validate/analyze_contradictions/
  // suggest_improvements veem o estado atual do doc). Snapshot persistido é
  // fallback defensivo quando Drive falha ou quando o contrato (legado) ainda
  // não tem doc associado.
  let htmlContent: string;
  if (contract.googleDocId) {
    const { getDocPlainText } = await import("@/lib/google/docs");
    htmlContent = await getDocPlainText(contract.googleDocId);
  } else {
    htmlContent = contract.htmlContent || "";
  }

  return {
    contractId,
    userId: contract.userId,
    orgId,
    htmlContent,
    dataJson: contract.dataJson as Record<string, unknown>,
    templateModalidade: contract.template?.modalidade || "a_vista",
    templateName: contract.template?.name ?? "Contrato importado",
    dealKind: contract.deal?.kind ?? "venda",
    dealId: contract.dealId,
    activeClauses: contract.clauses.map((cc) => ({
      id: cc.id,
      clauseId: cc.knowledgeItem.id,
      title: cc.knowledgeItem.title,
      // `subcategory` carrega a categoria semântica (partes/objeto/preco/...)
      // que vivia em Clause.category pré-unificação. Fallback `category`
      // ("clause" sempre) cobre rows criadas direto sem subcategory.
      category: cc.knowledgeItem.subcategory ?? cc.knowledgeItem.category,
      position: cc.position,
      isActive: cc.isActive,
    })),
    googleDocId: contract.googleDocId,
  };
}
