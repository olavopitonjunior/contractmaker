/**
 * Fanout do planner por FAMÍLIA — a decisão de conjunto, repartida.
 *
 * Uma chamada única para o lote inteiro tinha dois custos medidos em staging:
 * 221 s de latência com 20 documentos (contra 92–170 s com 11 — cresce com o
 * lote e se aproxima do `maxDuration`) e um teto de saída que estourou no
 * primeiro lote grande. A família é a fronteira natural de corte: os grupos de
 * consolidação nunca atravessam famílias (a chave fina inclui a modalidade), o
 * playbook é por família, e as decisões inter-família se resumem às cláusulas
 * de fornecedor — que são deduplicadas DETERMINISTICAMENTE no merge, porque a
 * regra de produto já diz que a cláusula é uma só (regra 3 do prompt).
 *
 * O que este módulo faz é PURO: repartir o lote e fundir os planos. Quem chama
 * as escadas (uma por família, em paralelo) é o `run-executor`.
 *
 * ## Por que o merge pode deduplicar cláusula sem perguntar ao modelo
 *
 * Residencial e comercial propõem, cada um, a cláusula da Porto Seguro — nenhum
 * vê o plano do outro. Mas duas cláusulas com o MESMO conjunto de tags são, por
 * definição do acervo, a mesma cláusula (é por igualdade de conjunto que a
 * ingestão arquiva). Ficar com a de texto mais longo é ficar com a redação mais
 * completa; a outra teria sido arquivada pela primeira de qualquer jeito.
 */

import type { GroupingReport } from "./grouping";
import type { LibraryPlan, PlannedClause } from "./library-plan";
import { LIBRARY_PLAN_VERSION } from "./library-plan";
import { playbookFamilyForModalidade } from "./playbooks";

/** Item mínimo que a repartição precisa enxergar. */
export interface FanoutItem {
  id: string;
  classification: { modalidade?: string | null } | null;
}

/**
 * Chave de família do PLANNER. Segue o playbook, com uma exceção: locação
 * residencial e comercial separam — são os dois maiores volumes de um acervo
 * imobiliário e a separação é o que corta a latência pela metade.
 */
export function planFamilyKey(modalidade: string | null | undefined): string | null {
  const family = playbookFamilyForModalidade(modalidade);
  if (!family) return null;
  if (family === "locacao") {
    return (modalidade ?? "").trim() === "locacao_comercial"
      ? "locacao_comercial"
      : "locacao";
  }
  return family;
}

/** Rótulos humanos — progresso na tela e no relatório. */
export const PLAN_FAMILY_LABELS: Record<string, string> = {
  locacao: "Locação residencial",
  locacao_comercial: "Locação comercial",
  administracao: "Administração",
  venda: "Venda",
  proposta: "Propostas",
};

export interface FamilySplit<Item extends FanoutItem> {
  key: string;
  items: Item[];
  grouping: GroupingReport;
}

/**
 * Reparte o lote por família do planner. Item sem modalidade reconhecida
 * (extração falhou, classificação vazia) vai para a MAIOR família: ele precisa
 * de um planner para ser descartado com motivo, e a maior chamada é onde o
 * custo marginal de carregá-lo é menor.
 */
export function splitBatchByFamily<Item extends FanoutItem>(
  items: readonly Item[],
  grouping: GroupingReport
): FamilySplit<Item>[] {
  const byKey = new Map<string, Item[]>();
  const orphans: Item[] = [];
  for (const item of items) {
    const key = planFamilyKey(item.classification?.modalidade ?? null);
    if (!key) {
      orphans.push(item);
      continue;
    }
    const bucket = byKey.get(key) ?? [];
    bucket.push(item);
    byKey.set(key, bucket);
  }

  if (byKey.size === 0) {
    // Lote inteiro sem modalidade: uma família só, como antes do fanout.
    return orphans.length > 0
      ? [
          {
            key: "lote",
            items: orphans,
            grouping: filterGrouping(grouping, new Set(orphans.map((i) => i.id))),
          },
        ]
      : [];
  }

  if (orphans.length > 0) {
    const largest = [...byKey.entries()].sort(
      (a, b) => b[1].length - a[1].length
    )[0][0];
    byKey.get(largest)!.push(...orphans);
  }

  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, familyItems]) => ({
      key,
      items: familyItems,
      grouping: filterGrouping(grouping, new Set(familyItems.map((i) => i.id))),
    }));
}

/** Recorta o relatório de agrupamento para os itens de UMA família. */
export function filterGrouping(
  grouping: GroupingReport,
  itemIds: ReadonlySet<string>
): GroupingReport {
  return {
    families: grouping.families
      .map((f) => ({ ...f, itemIds: f.itemIds.filter((id) => itemIds.has(id)) }))
      .filter((f) => f.itemIds.length > 0),
    // Grupo com membro fora da família não existe (a chave fina inclui a
    // modalidade); o filtro é só a projeção.
    groups: grouping.groups.filter((g) =>
      g.memberIds.every((id) => itemIds.has(id))
    ),
    singles: grouping.singles.filter((id) => itemIds.has(id)),
    groupedAt: grouping.groupedAt,
  };
}

function tagSetKey(tags: readonly string[]): string {
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)))
    .sort()
    .join("|");
}

export interface FamilyPlanOutcome {
  key: string;
  plan: LibraryPlan;
  accepted: boolean;
}

export interface MergedPlan {
  plan: LibraryPlan;
  accepted: boolean;
  /** Cláusulas removidas no merge por duplicidade de conjunto de tags. */
  dedupedClauses: Array<{ kept: string; dropped: string }>;
}

/**
 * Funde os planos das famílias num plano único do lote.
 *
 * - templates/descartes/issues concatenam (modalidades são disjuntas entre
 *   famílias — não há colisão de critério a re-checar aqui);
 * - cláusulas deduplicam por conjunto de tags, mantendo a de texto mais longo;
 * - confiança final é a MÍNIMA (o operador reage ao elo fraco, não à média);
 * - aceito só quando TODAS as famílias aceitaram.
 */
export function mergeFamilyPlans(outcomes: readonly FamilyPlanOutcome[]): MergedPlan {
  const clausesByTagSet = new Map<string, PlannedClause>();
  const deduped: Array<{ kept: string; dropped: string }> = [];

  for (const outcome of outcomes) {
    for (const clause of outcome.plan.clauses ?? []) {
      const key = tagSetKey(clause.tags ?? []);
      const existing = clausesByTagSet.get(key);
      if (!existing) {
        clausesByTagSet.set(key, clause);
        continue;
      }
      const keep =
        (clause.content ?? "").length > (existing.content ?? "").length
          ? clause
          : existing;
      const drop = keep === clause ? existing : clause;
      clausesByTagSet.set(key, keep);
      deduped.push({ kept: keep.title, dropped: drop.title });
    }
  }

  const confidences = outcomes.map((o) => o.plan.confidence ?? 0);
  return {
    plan: {
      version: LIBRARY_PLAN_VERSION,
      templates: outcomes.flatMap((o) => o.plan.templates ?? []),
      clauses: [...clausesByTagSet.values()],
      discards: outcomes.flatMap((o) => o.plan.discards ?? []),
      issues: outcomes.flatMap((o) => o.plan.issues ?? []),
      confidence: confidences.length > 0 ? Math.min(...confidences) : 0,
    },
    accepted: outcomes.length > 0 && outcomes.every((o) => o.accepted),
    dedupedClauses: deduped,
  };
}
