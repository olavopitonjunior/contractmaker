import type { PlanStep } from "./types";

export interface UnmetDep {
  id: string;
  description: string;
  status: string;
}

/**
 * Dado um step de plano com `dependsOn` (IDs de steps anteriores cujo sucesso ele
 * pressupõe), retorna as dependências que NÃO foram concluídas com sucesso
 * (status !== "executed", ou dependência inexistente). Lista vazia => pode rodar.
 *
 * Usado pelo execute-plan pra PULAR (status "skipped") um step com premissa falsa
 * — ex.: um add_comment que afirma "a cláusula inserida acima" quando o
 * insert_clause correspondente falhou (bug #6 do QA de locação 2026-06-06).
 */
export function unmetDependencies(step: PlanStep, all: PlanStep[]): UnmetDep[] {
  if (!Array.isArray(step.dependsOn) || step.dependsOn.length === 0) return [];
  const byId = new Map(all.map((s) => [s.id, s]));
  const unmet: UnmetDep[] = [];
  for (const depId of step.dependsOn) {
    const dep = byId.get(depId);
    if (dep && dep.status === "executed") continue;
    unmet.push({
      id: depId,
      description: dep?.description ?? "passo anterior",
      status: dep?.status ?? "ausente",
    });
  }
  return unmet;
}
