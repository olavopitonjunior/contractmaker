/**
 * Agrupamento do lote — o último estágio determinístico da Fase A1.
 *
 * Não há nada de novo na COMPARAÇÃO: `lib/templates/consolidation.ts` já sabe
 * agrupar documentos quase idênticos, extrair a base comum e isolar os blocos
 * divergentes, tudo sem IA. O que este módulo acrescenta é o RECORTE — decidir
 * quem pode ser comparado com quem — e a serialização do resultado para o run,
 * onde a Fase A2 vai buscá-lo.
 *
 * O recorte é a chave de família FINA (`lib/ingestion/classifier.ts`):
 * `{docType}:{modalidade}:{garantiaTipo}`. `groupSimilarDocs` já recusa cruzar
 * famílias diferentes, então basta passar a chave em `NormalizedDoc.family` — a
 * guarda vem de graça e `consolidation.ts` fica intocado.
 *
 * Módulo puro: recebe itens já classificados e devolve um objeto JSON-serializável.
 */

import {
  buildConsolidationPlan,
  buildDifferenceMatrix,
  groupSimilarDocs,
  normalizeDoc,
  primaryDifferenceRow,
  type GroupCriterion,
} from "@/lib/templates/consolidation";

/** Item pronto para agrupar — o mínimo que o executor precisa carregar. */
export interface GroupableItem {
  id: string;
  filename: string;
  text: string;
  familyKey: string;
}

/**
 * Teto do texto de variante levado para o relatório. Espelha o `max(20_000)` de
 * `POST /api/templates/ingest/clauses`: guardar mais do que a ingestão de
 * cláusula aceita só engordaria o Json do run sem nunca ser usado.
 */
export const MAX_VARIANT_CHARS = 20_000;

export interface GroupedFamily {
  familyKey: string;
  itemIds: string[];
}

export interface ConsolidationCandidate {
  /** Id do grupo — o do 1º membro, como em `groupSimilarDocs`. */
  id: string;
  familyKey: string;
  memberIds: string[];
  /** Elo mais fraco do grupo (Dice) — o "% idêntico" mostrado ao operador. */
  minSimilarity: number;
  minContainment: number;
  linkedBy: GroupCriterion;
  /** Documento cujo texto vira a base do modelo consolidado. */
  referenceItemId: string;
  /** Quantos parágrafos os membros têm em comum. */
  commonParagraphCount: number;
  /**
   * A posição do documento onde a divergência é MAIOR — a que viraria o slot.
   * Null quando os membros não divergem em lugar nenhum (cópias exatas).
   */
  primary: {
    anchorIndex: number;
    /** itemId → parágrafos daquela variante nessa posição. */
    byItem: Record<string, string[]>;
  } | null;
}

export interface GroupingReport {
  /** Uma família por chave fina, com os itens que caíram nela. */
  families: GroupedFamily[];
  /** Grupos de 2+ membros — os candidatos a consolidação. */
  groups: ConsolidationCandidate[];
  /** Itens que não agruparam com ninguém: seguem o caminho simples. */
  singles: string[];
  groupedAt: string;
}

/**
 * Agrupa o lote por família fina e devolve o relatório que fica em
 * `IngestionRun.report.grouping`.
 *
 * Itens sem texto (extração falhou, descarte sugerido) simplesmente não entram —
 * comparar contra string vazia produziria similaridade 0 com todo mundo e
 * poluiria o relatório com "singles" que não são documentos.
 */
export function buildGroupingReport(
  items: readonly GroupableItem[],
  now: Date = new Date()
): GroupingReport {
  const usable = items.filter((i) => i.text.trim().length > 0);

  const byFamily = new Map<string, GroupableItem[]>();
  for (const item of usable) {
    const list = byFamily.get(item.familyKey);
    if (list) list.push(item);
    else byFamily.set(item.familyKey, [item]);
  }

  const families: GroupedFamily[] = [];
  const groups: ConsolidationCandidate[] = [];
  const grouped = new Set<string>();

  for (const [key, members] of byFamily) {
    families.push({ familyKey: key, itemIds: members.map((m) => m.id) });

    const normalized = members.map((m) =>
      normalizeDoc({ id: m.id, name: m.filename, text: m.text, family: key })
    );
    const byId = new Map(normalized.map((d) => [d.id, d]));

    for (const group of groupSimilarDocs(normalized)) {
      const docs = group.memberIds
        .map((id) => byId.get(id))
        .filter((d): d is NonNullable<typeof d> => Boolean(d));
      if (docs.length < 2) continue;

      const plan = buildConsolidationPlan(docs);
      const primaryRow = primaryDifferenceRow(buildDifferenceMatrix(plan));

      for (const id of group.memberIds) grouped.add(id);
      groups.push({
        id: group.id,
        familyKey: key,
        memberIds: group.memberIds,
        minSimilarity: group.minSimilarity,
        minContainment: group.minContainment,
        linkedBy: group.linkedBy,
        referenceItemId: plan.referenceDocId,
        commonParagraphCount: plan.commonParagraphs.length,
        primary: primaryRow
          ? {
              anchorIndex: primaryRow.anchorIndex,
              byItem: capVariants(primaryRow.byDoc),
            }
          : null,
      });
    }
  }

  return {
    families,
    groups,
    singles: usable.filter((i) => !grouped.has(i.id)).map((i) => i.id),
    groupedAt: now.toISOString(),
  };
}

/** Corta cada variante em `MAX_VARIANT_CHARS`, preservando limites de parágrafo. */
function capVariants(byDoc: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [docId, paragraphs] of Object.entries(byDoc)) {
    const kept: string[] = [];
    let used = 0;
    for (const p of paragraphs) {
      if (used + p.length > MAX_VARIANT_CHARS) break;
      kept.push(p);
      used += p.length;
    }
    out[docId] = kept;
  }
  return out;
}
