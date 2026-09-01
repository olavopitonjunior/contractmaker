/**
 * Tipos compartilhados entre os componentes da biblioteca de cláusulas
 * (/clauses). Espelha o shape que `ClausesPage` (server) monta a partir de
 * `KnowledgeItem` (category="clause") + `orgUsageCount` — ver
 * `src/app/(dashboard)/clauses/page.tsx`.
 */

/** Linha da biblioteca de cláusulas, já achatada pro client (datas em ISO). */
export interface Clause {
  id: string;
  title: string;
  content: string;
  /** Alias legado de `subcategory` (retrocompat com a UI antiga). */
  category: string;
  subcategory: string | null;
  groupCode: string | null;
  /** "venda" | "locacao" | "ambas"; `null` = ainda não classificada. */
  esteira: string | null;
  isVariable: boolean;
  agentNotes: string | null;
  tags: string[];
  status: string;
  source: string | null;
  /** `null` = cláusula da PLATAFORMA: visível a todo tenant, só leitura fora do /admin. */
  orgId: string | null;
  /** Uso agregado (todas as orgs, cláusula de plataforma inclusive). */
  usageCount: number;
  /** Uso POR TENANT — o que esta imobiliária consumiu (KnowledgeItemUsage). */
  orgUsageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Cláusula de slot da org que tem versão mais recente na plataforma. */
export interface PlatformUpdate {
  orgClauseId: string;
  platformClauseId: string;
  platformTitle: string;
  platformUpdatedAt: string;
}

/** Item da plataforma: ações de escrita somem, porque a API recusaria. */
export function isPlatformClause(c: Pick<Clause, "orgId">): boolean {
  return c.orgId === null;
}

/** Rótulo PT-BR compartilhado pelos badges de status (tabela, detail, editor). */
export const CLAUSE_STATUS_LABEL: Record<string, string> = {
  approved: "Aprovada",
  pending: "Pendente",
  draft: "Rascunho",
};

/** Variante do `Badge` por status. */
export const CLAUSE_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  approved: "default",
  pending: "secondary",
  draft: "outline",
};
