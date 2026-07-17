/**
 * Configuração de stages por `pipeline.kind`. Os nomes de stage diferem por
 * esteira (venda × locação) e várias rotas precisam decidir terminal/fallback
 * pelo kind — mesmo padrão de `lib/contracts/auto-promote-signed.ts`.
 *
 * Fallback é sempre "venda": pipelines legados têm `kind` null e não podem
 * regredir de comportamento.
 */

export const LOST_STAGE_NAME = "Negócio perdido";

/** Terminal FELIZ por kind — contrato nominal (não posicional). */
export const WON_STAGE_BY_KIND: Record<string, string> = {
  venda: "Comissão paga",
  locacao: "ADM",
};

/** Stages terminais (feliz + perdido) — bloqueiam mark-lost. */
export const TERMINAL_STAGES_BY_KIND: Record<string, readonly string[]> = {
  venda: [WON_STAGE_BY_KIND.venda, LOST_STAGE_NAME],
  locacao: [WON_STAGE_BY_KIND.locacao, LOST_STAGE_NAME],
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

/**
 * Aging por stage (badge "Xd parado" no card). O badge só aparece a partir de
 * AGING_WARN_DAYS (âmbar) e fica vermelho em AGING_DANGER_DAYS — card saudável
 * fica limpo. Stages terminais não envelhecem.
 */
export const AGING_WARN_DAYS = 5;
export const AGING_DANGER_DAYS = 10;

const ALL_TERMINAL_STAGES = new Set(
  Object.values(TERMINAL_STAGES_BY_KIND).flat()
);

export function isTerminalStageName(name: string | null | undefined): boolean {
  return !!name && ALL_TERMINAL_STAGES.has(name);
}

export function stageConfigForKind(kind: string | null | undefined): StageConfig {
  const key = kind && kind in TERMINAL_STAGES_BY_KIND ? kind : "venda";
  return {
    terminalStages: TERMINAL_STAGES_BY_KIND[key],
    reopenFallback: REOPEN_FALLBACK_BY_KIND[key],
  };
}
