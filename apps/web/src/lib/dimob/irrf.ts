/**
 * IRRF (imposto de renda retido na fonte) sobre aluguel, para a DIMOB de locação (R02).
 *
 * O app NÃO persiste o IRRF (só um proxy 27,5% no simulador de repasse), então
 * calculamos aqui, na geração da DIMOB, pela **tabela progressiva mensal** do IR.
 * Retido apenas quando `regimeIr = "retem_imobiliaria"` (a imobiliária retém) e o
 * locador é PF. Locador PJ ou outros regimes → 0. O usuário pode sempre ajustar
 * qualquer valor mensal via override na grade.
 *
 * ⚠️ A tabela muda por ato do governo — ATUALIZAR `IRRF_TABLE_BY_YEAR` a cada
 * ano-calendário (mesmo padrão de `PRICING` em lib/ai/usage.ts). Faixas ausentes
 * caem na tabela do ano mais recente disponível.
 */

export interface IrrfBracket {
  /** Limite superior da faixa (inclusive) em reais; null = última faixa (sem teto). */
  upTo: number | null;
  /** Alíquota (fração, ex.: 0.275). */
  rate: number;
  /** Parcela a deduzir em reais. */
  deduct: number;
}

/** Tabela progressiva mensal do IRRF por ano-calendário. */
export const IRRF_TABLE_BY_YEAR: Record<number, IrrfBracket[]> = {
  // Vigente desde fev/2024 (Lei 14.848/2024). Usada como base p/ 2024–2026 até atualização.
  2024: [
    { upTo: 2259.2, rate: 0, deduct: 0 },
    { upTo: 2826.65, rate: 0.075, deduct: 169.44 },
    { upTo: 3751.05, rate: 0.15, deduct: 381.44 },
    { upTo: 4664.68, rate: 0.225, deduct: 662.77 },
    { upTo: null, rate: 0.275, deduct: 896.0 },
  ],
  2025: [
    { upTo: 2259.2, rate: 0, deduct: 0 },
    { upTo: 2826.65, rate: 0.075, deduct: 169.44 },
    { upTo: 3751.05, rate: 0.15, deduct: 381.44 },
    { upTo: 4664.68, rate: 0.225, deduct: 662.77 },
    { upTo: null, rate: 0.275, deduct: 896.0 },
  ],
  2026: [
    { upTo: 2259.2, rate: 0, deduct: 0 },
    { upTo: 2826.65, rate: 0.075, deduct: 169.44 },
    { upTo: 3751.05, rate: 0.15, deduct: 381.44 },
    { upTo: 4664.68, rate: 0.225, deduct: 662.77 },
    { upTo: null, rate: 0.275, deduct: 896.0 },
  ],
};

export function resolveIrrfTable(year: number): IrrfBracket[] {
  const exact = IRRF_TABLE_BY_YEAR[year];
  if (exact) return exact;
  const years = Object.keys(IRRF_TABLE_BY_YEAR).map(Number);
  const latest = years.length ? Math.max(...years) : 0;
  return IRRF_TABLE_BY_YEAR[latest] ?? [];
}

/**
 * IRRF de um mês sobre o aluguel (base = valor recebido do locador PF no mês).
 * Retorna 0 quando não há retenção pela imobiliária, quando o locador é PJ, ou
 * quando a base cai na faixa isenta.
 */
export function computeMonthlyIrrf(
  rentAmount: number,
  tipoPessoa: "fisica" | "juridica" | string | undefined,
  regimeIr: string | undefined,
  year: number
): number {
  if (regimeIr !== "retem_imobiliaria") return 0;
  if (tipoPessoa === "juridica") return 0;
  if (!(rentAmount > 0)) return 0;

  const table = resolveIrrfTable(year);
  const bracket = table.find((b) => b.upTo === null || rentAmount <= b.upTo);
  if (!bracket || bracket.rate === 0) return 0;

  const ir = rentAmount * bracket.rate - bracket.deduct;
  return ir > 0 ? Math.round(ir * 100) / 100 : 0;
}
