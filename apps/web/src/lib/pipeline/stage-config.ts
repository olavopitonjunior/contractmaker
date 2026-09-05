/**
 * Configuração de stages por `pipeline.kind`. Os nomes de stage diferem por
 * esteira (venda × locação) e várias rotas precisam decidir terminal/fallback
 * pelo kind — mesmo padrão de `lib/contracts/auto-promote-signed.ts`.
 *
 * Fallback é sempre "venda": pipelines legados têm `kind` null e não podem
 * regredir de comportamento.
 */

export const LOST_STAGE_NAME = "Negócio perdido";

/** Terminal FELIZ por kind — contrato nominal (não posicional). FONTE ÚNICA
 *  do nome: auto-promote-commission re-exporta daqui (a aresta é invertida de
 *  propósito — este módulo é importado por components "use client" e não pode
 *  puxar cadeia com Prisma). */
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

/**
 * Stages de VENDA a partir dos quais a venda pode ser enviada para a
 * Superlógica (FONTE ÚNICA: server em lib/superlogica/export/export-deal.ts
 * e botão/tooltip do DealDetail leem daqui). O destino após exportar é
 * "Cobrança emitida" — a cobrança passa a ser da Superlógica.
 */
export const SUPERLOGICA_EXPORTABLE_STAGES: readonly string[] = [
  "Contrato assinado",
  "Cobrança emitida",
];

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

/** Dias inteiros desde a entrada no stage atual (fallback: criação do deal). */
export function daysInStage(
  stageEnteredAt: string | null | undefined,
  createdAt: string,
  nowMs: number
): number {
  const enteredMs = new Date(stageEnteredAt ?? createdAt).getTime();
  return Math.floor((nowMs - enteredMs) / 86_400_000);
}

/**
 * Regra única de "deal parado" — badge "Xd parado" do card e filtro "Só
 * parados" do board DEVEM concordar; mudanças na regra acontecem só aqui.
 * Perdidos e stages terminais não envelhecem.
 */
export function isStaleDeal(
  deal: { lostAt: string | null; stageEnteredAt?: string | null; createdAt: string },
  stageName: string | null | undefined,
  nowMs: number
): boolean {
  if (deal.lostAt || isTerminalStageName(stageName)) return false;
  return daysInStage(deal.stageEnteredAt, deal.createdAt, nowMs) >= AGING_WARN_DAYS;
}

export function stageConfigForKind(kind: string | null | undefined): StageConfig {
  const key = kind && kind in TERMINAL_STAGES_BY_KIND ? kind : "venda";
  return {
    terminalStages: TERMINAL_STAGES_BY_KIND[key],
    reopenFallback: REOPEN_FALLBACK_BY_KIND[key],
  };
}
