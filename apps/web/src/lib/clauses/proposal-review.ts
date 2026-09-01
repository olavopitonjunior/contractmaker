/**
 * Modelo de decisões da revisão de classificação — puro, testável fora do React.
 *
 * Espelha a disciplina de `lib/ingestion/plan-review.ts`: o estado da tela é um
 * mapa de decisões, e o payload enviado ao servidor é derivado dele de forma
 * FAIL-CLOSED — campo sem `true` explícito não é aplicado. Revisar é vetar, não
 * reconstruir: tudo nasce marcado, menos o que exige um segundo olhar.
 */
import type { ClauseClassificationProposal } from "@/lib/clauses/classify";

/** Campos que o revisor liga/desliga individualmente. */
export const REVIEWABLE_FIELDS = [
  "esteira",
  "groupCode",
  "subcategory",
  "tags",
  "agentNotes",
  "content",
] as const;

export type ReviewableField = (typeof REVIEWABLE_FIELDS)[number];

/** `clauseId` → campo → aprovado. */
export type ReviewDecisions = Record<string, Partial<Record<ReviewableField, boolean>>>;

/**
 * Decisões iniciais: metadados marcados, CONTEÚDO desmarcado.
 *
 * O conteúdo sai desmarcado de propósito — é o único campo que reescreve texto
 * contratual, e `ContractClause` não guarda snapshot, então a mudança alcança
 * todo contrato que referencia a cláusula. Aprovar isso tem que ser um ato
 * deliberado, não o default de quem clicou "aplicar" sem ler.
 */
export function defaultDecisions(
  proposals: readonly ClauseClassificationProposal[]
): ReviewDecisions {
  const out: ReviewDecisions = {};
  for (const p of proposals) {
    const d: Partial<Record<ReviewableField, boolean>> = {};
    for (const f of REVIEWABLE_FIELDS) {
      if (p.fields[f] === undefined) continue;
      d[f] = f !== "content";
    }
    out[p.clauseId] = d;
  }
  return out;
}

export function setField(
  decisions: ReviewDecisions,
  clauseId: string,
  field: ReviewableField,
  value: boolean
): ReviewDecisions {
  return { ...decisions, [clauseId]: { ...decisions[clauseId], [field]: value } };
}

/** Liga/desliga tudo de uma cláusula (menos o que ela não propõe). */
export function setAllForClause(
  decisions: ReviewDecisions,
  proposal: ClauseClassificationProposal,
  value: boolean
): ReviewDecisions {
  const d: Partial<Record<ReviewableField, boolean>> = {};
  for (const f of REVIEWABLE_FIELDS) {
    if (proposal.fields[f] !== undefined) d[f] = value;
  }
  return { ...decisions, [proposal.clauseId]: d };
}

/** Quantos campos estão aprovados no total — alimenta o rodapé "Aplicar N". */
export function countApproved(decisions: ReviewDecisions): number {
  let n = 0;
  for (const byField of Object.values(decisions)) {
    for (const v of Object.values(byField)) if (v) n += 1;
  }
  return n;
}

export interface ReviewedItem {
  clauseId: string;
  approve: Partial<Record<ReviewableField, boolean>>;
  values: {
    esteira?: string | null;
    groupCode?: string | null;
    subcategory?: string | null;
    tags?: string[];
    agentNotes?: string | null;
    content?: string;
  };
}

/**
 * Payload do `apply`, só com o que foi aprovado.
 *
 * Fail-closed em dois níveis: cláusula sem nenhum campo aprovado nem entra na
 * lista, e dentro de cada item só vão as chaves marcadas `true`. O servidor
 * revalida tudo de novo — isto aqui é conveniência, não autoridade.
 */
export function buildReviewedItems(
  proposals: readonly ClauseClassificationProposal[],
  decisions: ReviewDecisions
): ReviewedItem[] {
  const items: ReviewedItem[] = [];

  for (const p of proposals) {
    const d = decisions[p.clauseId] ?? {};
    const approve: Partial<Record<ReviewableField, boolean>> = {};
    const values: ReviewedItem["values"] = {};

    for (const f of REVIEWABLE_FIELDS) {
      if (d[f] !== true) continue;
      const field = p.fields[f];
      if (field === undefined) continue;
      approve[f] = true;
      // `proposed` é o valor novo; o `current` só existe pro diff da tela.
      (values as Record<string, unknown>)[f] = field.proposed;
    }

    if (Object.keys(approve).length === 0) continue;
    items.push({ clauseId: p.clauseId, approve, values });
  }

  return items;
}
