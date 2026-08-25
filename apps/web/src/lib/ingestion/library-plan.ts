/**
 * LibraryPlan — o que o lote de documentos vai virar na biblioteca da org.
 *
 * É o contrato entre os três lados da ingestão automática:
 *
 *   planner (Fase A2)  →  LibraryPlan  →  revisão humana  →  executor
 *
 * O planner é o segundo ponto de julgamento por LLM ("olhando o CONJUNTO, o que
 * é template e o que é cláusula?"). Ele NÃO escreve no banco: devolve este
 * plano, que passa por guardrails determinísticos e por uma tela de revisão
 * antes de qualquer escrita. Um plano recusado custa revisão humana a mais —
 * nunca uma biblioteca errada.
 *
 * ## As duas regras de produto que o formato carrega
 *
 * 1. **Garantia diferente ⇒ template físico diferente.** Por isso todo template
 *    de locação carrega `matchCriteria.garantia`: é ele que faz
 *    `pickTemplateByFacts` eleger o modelo certo a partir do formulário.
 * 2. **Fornecedor diferente ⇒ mesma base, cláusula diferente.** O fornecedor
 *    NUNCA aparece no corpo do template (ver {@link PlannedTemplate.slotBlocks}
 *    e a issue `provider_in_template`); ele vive na tag `provider:<slug>` da
 *    cláusula, eleita em tempo de geração por `resolveClauseSlots`.
 *
 * ## Por que o plano referencia itens por id, e não texto
 *
 * O conteúdo do template vem do DOCX original (é ele que preserva o timbre da
 * imobiliária), então o planner escolhe QUAL item vira template — não redige.
 * Cláusula é o único lugar onde texto do plano vira texto no banco, e é
 * exatamente por isso que ele passa pelo gate de PII antes.
 */

import type { GarantiaTipo } from "@/lib/contracts/template-category";
import type { ClauseSlotKey } from "@/lib/templates/clause-slots";

/** Versão do formato — plano gravado com versão desconhecida não é executado. */
export const LIBRARY_PLAN_VERSION = 1 as const;

/**
 * Eixos de `ContractTemplate.matchCriteria` que o plano pode propor. Espelha
 * `MATCH_FIELDS` de `lib/contracts/template-category.ts`; `garantia` é
 * obrigatória em locação (ver guardrails).
 */
export interface PlannedMatchCriteria {
  garantia?: GarantiaTipo;
  fiadorPessoa?: "pf" | "pj";
  pessoa?: "pf" | "pj";
  admImobiliaria?: boolean;
}

export interface PlannedTemplate {
  /** `IngestionItem.id` cujo DOCX vira o modelo — precisa existir no run. */
  sourceItemId: string;
  name: string;
  /** Modalidade canônica (`locacao`, `locacao_comercial`, `a_vista`…). */
  modalidade: string;
  matchCriteria: PlannedMatchCriteria;
  /**
   * Parágrafos LITERAIS do doc fonte que saem do corpo e viram slot. É o que
   * mantém o template neutro de fornecedor: o trecho que nomeia a seguradora
   * vira `{{slot_garantia}}` e a redação certa entra na geração.
   *
   * Precisam bater exatamente com parágrafos do texto extraído — quem aplica é
   * `applyClauseSlotToDoc`, que é tudo-ou-nada por ocorrência única.
   */
  slotBlocks?: Partial<Record<ClauseSlotKey, string[]>>;
  /** Sugestão de "principal da modalidade"; só vale na ATIVAÇÃO, nunca aqui. */
  isDefaultSuggested?: boolean;
  /** Id do grupo de consolidação que originou este template, quando houver. */
  groupId?: string;
  /** Uma frase em PT-BR: por que este item virou template. */
  rationale: string;
}

export interface PlannedClause {
  slot: ClauseSlotKey;
  /** Opção do formulário — vira a tag `garantia:<value>`. */
  value: string;
  /** Rótulo humano do fornecedor ("Porto Seguro") ou null na cláusula genérica. */
  provider: string | null;
  title: string;
  /**
   * Texto da cláusula JÁ SANITIZADO. Este é o único campo do plano que vira
   * texto persistido com embedding — PII aqui é irreversível, então o executor
   * roda o gate de `lib/ingestion/pii.ts` antes de gravar.
   */
  content: string;
  sourceItemId: string;
  /**
   * Conjunto EXATO de tags que a cláusula terá. Redundante com os campos acima
   * de propósito: é por igualdade deste conjunto que a ingestão decide o que
   * arquivar (ver `lib/templates/ingest-clauses.ts`), então ele é revisável.
   */
  tags: string[];
  rationale: string;
}

export type PlanDiscardReason =
  | "duplicate"
  | "filled_instance"
  | "unreadable"
  | "out_of_scope"
  | "pii_unrecoverable";

export interface PlanDiscard {
  itemId: string;
  reason: PlanDiscardReason;
  /** Frase em PT-BR mostrada na revisão — o operador pode discordar. */
  detail: string;
}

/**
 * `provider_in_template` é o guardrail da regra 2: o planner propôs um modelo
 * que nomeia fornecedor fora do slot. `grouping_ambiguous` e `low_confidence`
 * pedem olho humano; `pii_leftover` bloqueia sugerir ativação do template.
 *
 * `plan_invalid` é a violação de regra dura que sobreviveu à escalação — o
 * plano foi RECUSADO pelos guardrails, não apenas achado duvidoso. Existe
 * separado de `low_confidence` porque quem lê a tela de revisão precisa saber a
 * diferença: "o modelo hesitou" e "o modelo propôs algo proibido" pedem reações
 * diferentes do operador. O motivo concreto vai no `detail`.
 *
 * `index_truncated` e `acervo_incompleto` nomeiam lacunas de lados opostos e
 * por isso não se fundem: `acervo_incompleto` é falta no material do CLIENTE
 * (não veio o modelo de um caso que a imobiliária claramente opera);
 * `index_truncated` é falta no que o PLANNER viu (o material veio, mas não
 * coube no índice de blocos). O operador reage diferente: no primeiro caso
 * pede mais documentos, no segundo revisa uma decisão tomada sobre amostra.
 */
export type PlanIssueKind =
  | "classification_conflict"
  | "provider_in_template"
  | "pii_leftover"
  | "slot_not_applicable"
  | "plan_invalid"
  | "low_confidence"
  | "grouping_ambiguous"
  | "index_truncated"
  | "acervo_incompleto";

export interface PlanIssue {
  itemId: string | null;
  kind: PlanIssueKind;
  detail: string;
}

export interface LibraryPlan {
  version: typeof LIBRARY_PLAN_VERSION;
  templates: PlannedTemplate[];
  clauses: PlannedClause[];
  discards: PlanDiscard[];
  issues: PlanIssue[];
  /** Autoavaliação do planner; abaixo do piso, escala de modelo. */
  confidence: number;
}

/**
 * Plano depois da revisão humana. O que o operador desmarcou não é apagado —
 * fica no plano com `approved: false`, para o relatório final poder dizer o que
 * foi recusado e por quem.
 */
export interface ReviewedLibraryPlan {
  reviewedBy: string;
  reviewedAt: string;
  templates: Array<{ sourceItemId: string; approved: boolean }>;
  clauses: Array<{ sourceItemId: string; tags: string[]; approved: boolean }>;
  discards: Array<{ itemId: string; approved: boolean }>;
}
