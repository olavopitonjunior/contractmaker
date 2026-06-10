/**
 * Configuração de stages por `pipeline.kind`. Os nomes de stage diferem por
 * esteira (venda × locação) e várias rotas precisam decidir terminal/fallback
 * pelo kind — mesmo padrão de `lib/contracts/auto-promote-signed.ts`.
 *
 * Fallback é sempre "venda": pipelines legados têm `kind` null e não podem
 * regredir de comportamento.
 */

export const LOST_STAGE_NAME = "Negócio perdido";

/** Stages terminais (feliz + perdido) — bloqueiam mark-lost. */
export const TERMINAL_STAGES_BY_KIND: Record<string, readonly string[]> = {
  venda: ["Comissão paga", LOST_STAGE_NAME],
  locacao: ["ADM", LOST_STAGE_NAME],
};

/** Stage de retorno do reopen quando o audit não tem o stage anterior. */
export const REOPEN_FALLBACK_BY_KIND: Record<string, string> = {
  venda: "Confecção de Contrato",
  locacao: "Em contrato",
};

export interface StageConfig {
  terminalStages: readonly string[];
  reopenFallback: string;
}

export function stageConfigForKind(kind: string | null | undefined): StageConfig {
  const key = kind && kind in TERMINAL_STAGES_BY_KIND ? kind : "venda";
  return {
    terminalStages: TERMINAL_STAGES_BY_KIND[key],
    reopenFallback: REOPEN_FALLBACK_BY_KIND[key],
  };
}
