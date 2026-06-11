// Calculadora de reajuste de aluguel.
// Fase 2: stub com valores hardcoded por mês (proxy IGPM/IPCA dos últimos 12m).
// Fase 3+ trocar por client real (FGV/IBGE API ou parceiro).

export type Indice = "IGPM" | "IPCA" | "IGP-DI" | "outro";

// Acumulado 12m (referência aproximada — atualizar mensalmente).
// Em prod: buscar via API com cache em Upstash.
const ACUMULADO_12M_DEFAULT: Record<string, number> = {
  IGPM: 3.65,
  IPCA: 4.42,
  "IGP-DI": 3.21,
  outro: 0,
};

export interface ReadjustmentCalculation {
  indice: Indice;
  percentualAplicado: number;
  valorAnterior: number;
  valorNovo: number;
}

export function calculateReadjustment(
  valorAnterior: number,
  indice: Indice,
  percentualOverride?: number
): ReadjustmentCalculation {
  const percentual = percentualOverride ?? ACUMULADO_12M_DEFAULT[indice] ?? 0;
  const valorNovo = Number((valorAnterior * (1 + percentual / 100)).toFixed(2));
  return {
    indice,
    percentualAplicado: percentual,
    valorAnterior,
    valorNovo,
  };
}

/** Próxima data de reajuste = data base + 12 meses (Lei 8.245 art.19). */
export function nextReadjustmentDate(dataAtual: Date): Date {
  const next = new Date(dataAtual);
  next.setFullYear(next.getFullYear() + 1);
  return next;
}
