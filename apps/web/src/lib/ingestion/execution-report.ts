/**
 * Relatório final do run de ingestão — a forma gravada em
 * `IngestionRun.report.execution`.
 *
 * Módulo PURO (client-safe) porque a mesma estrutura é escrita pelo executor
 * (servidor, com prisma e Drive na mão) e LIDA pela tela de revisão. Tipos
 * duplicados nas duas pontas é como um relatório passa a mentir: o executor
 * grava `pii_blocked` e a tela, que só conhece `failed`, mostra "erro
 * desconhecido" para a única linha que precisava ser lida com atenção.
 *
 * O relatório responde cinco perguntas, nesta ordem de importância:
 *   1. o que passou a existir na biblioteca (com ids);
 *   2. o que NÃO passou — recusado pelo operador, descartado ou falho;
 *   3. o que foi barrado por dado pessoal;
 *   4. quanto custou de IA;
 *   5. o que a org cobre agora, e onde ainda tem buraco.
 */

import type { PlanDiscard, PlanIssue } from "./library-plan";
import type { GarantiaCoverageReport } from "@/lib/templates/coverage";

export const EXECUTION_REPORT_VERSION = 1 as const;

export type ExecutedTemplateStatus = "created" | "duplicate" | "failed";

export interface ExecutedTemplate {
  sourceItemId: string;
  filename: string;
  name: string;
  modalidade: string;
  status: ExecutedTemplateStatus;
  templateId?: string;
  webViewLink?: string;
  /** Slots que de fato abriram no Doc (o apply é tudo-ou-nada por slot). */
  slotsApplied?: string[];
  /**
   * Sugestão do planner de "principal da modalidade". REGISTRADA, nunca
   * aplicada: virar `isDefault` é decisão de ativação, e o modelo nasce draft.
   */
  isDefaultSuggested: boolean;
  detail?: string;
}

export type ExecutedClauseStatus =
  | "created"
  | "pii_blocked"
  | "duplicate_variant"
  | "failed";

export interface ExecutedClause {
  key: string;
  sourceItemId: string;
  slot: string;
  value: string;
  provider: string | null;
  title: string;
  tags: string[];
  status: ExecutedClauseStatus;
  knowledgeItemId?: string;
  /** Cláusulas do acervo que esta substituiu (mesmo conjunto exato de tags). */
  archivedIds?: string[];
  /** Categorias de PII que barraram a gravação. */
  piiKinds?: string[];
  detail?: string;
}

export interface ExecutionReport {
  version: typeof EXECUTION_REPORT_VERSION;
  startedAt: string;
  finishedAt: string | null;
  reviewedBy: string;
  reviewedAt: string;
  /** A fase de cláusulas já rodou por inteiro? É o que garante a ordem. */
  clausesDone: boolean;
  clauses: ExecutedClause[];
  templates: ExecutedTemplate[];
  /** O que o operador recusou — o relatório precisa saber dizer. */
  rejected: {
    templates: Array<{ sourceItemId: string; name: string }>;
    clauses: Array<{ key: string; title: string }>;
    /** Descartes com que o operador NÃO concordou. */
    discards: string[];
  };
  discards: PlanDiscard[];
  /**
   * Arquivos barrados NA ENTRADA (dedup por `sourceHash` — já eram um modelo da
   * biblioteca). O planner nunca os vê, então eles não aparecem em `discards`;
   * sem esta lista o operador sobe 20 arquivos e o relatório fala de 14 sem
   * explicar o buraco.
   */
  intakeDiscards?: Array<{ itemId: string; filename: string; detail: string }>;
  issues: PlanIssue[];
  counts: {
    templatesCreated: number;
    clausesCreated: number;
    piiBlocked: number;
    failures: number;
  };
  aiCostUsd: number | null;
  coverage: GarantiaCoverageReport | null;
}

/**
 * Lê o relatório de execução de dentro do `report` do run.
 *
 * Devolve `null` quando não há relatório ou quando a versão é outra: um
 * relatório de formato desconhecido renderizado "na sorte" mostraria contagens
 * erradas com cara de verdade.
 */
export function readExecutionReport(raw: unknown): ExecutionReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const execution = (raw as Record<string, unknown>).execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    return null;
  }
  const value = execution as Partial<ExecutionReport>;
  if (value.version !== EXECUTION_REPORT_VERSION) return null;
  return {
    ...(value as ExecutionReport),
    clauses: Array.isArray(value.clauses) ? value.clauses : [],
    templates: Array.isArray(value.templates) ? value.templates : [],
    discards: Array.isArray(value.discards) ? value.discards : [],
    issues: Array.isArray(value.issues) ? value.issues : [],
  };
}

export const TEMPLATE_STATUS_LABELS: Record<ExecutedTemplateStatus, string> = {
  created: "Modelo criado (rascunho)",
  duplicate: "Já existia — nada foi duplicado",
  failed: "Não foi criado",
};

export const CLAUSE_STATUS_LABELS: Record<ExecutedClauseStatus, string> = {
  created: "Cláusula no acervo (aguardando aprovação)",
  pii_blocked: "Barrada: dados pessoais no texto",
  duplicate_variant: "Combinação já ocupada por outra cláusula do lote",
  failed: "Não foi gravada",
};
