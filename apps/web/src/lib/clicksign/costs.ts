import type { AuthMethod } from "./types";

// Custo aproximado por assinatura em centavos de R$. Confirmar com o plano
// real da conta antes do deploy. Valores conservadores como ponto de partida.
// Atualizar manual quando preços mudarem (https://www.clicksign.com/preco).
export const CLICKSIGN_COST_CENTS: Record<AuthMethod, number> = {
  email: 150,
  whatsapp: 250,
  selfie: 900,
  icp_brasil: 350,
};

export function envelopeCostCents(authMethods: AuthMethod[]): number {
  return authMethods.reduce(
    (sum, m) => sum + (CLICKSIGN_COST_CENTS[m] ?? 0),
    0
  );
}

export function getMonthlyBudgetCents(): number {
  const raw = process.env.CLICKSIGN_MONTHLY_BUDGET_CENTS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}
