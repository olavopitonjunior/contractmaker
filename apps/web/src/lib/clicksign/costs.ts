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

/** Custo por método efetivo: override per-org (OrgSignatureSettings.costOverridesJson)
 *  sobre a tabela global hardcoded. `overrides` chega como Json do banco. */
export function costCentsForMethod(
  method: AuthMethod,
  overrides?: Record<string, unknown> | null
): number {
  const ov = overrides?.[method];
  if (typeof ov === "number" && Number.isFinite(ov) && ov >= 0) return ov;
  return CLICKSIGN_COST_CENTS[method] ?? 0;
}

/**
 * Custo do envelope = soma do custo POR SIGNATÁRIO. A quantidade de DOCUMENTOS
 * do envelope não entra na conta: a ClickSign cobra por signatário, então
 * contrato + laudo de vistoria no mesmo envelope custam o mesmo que só o
 * contrato (é justamente o motivo de existir o `EnvelopeDocument`).
 */
export function envelopeCostCents(
  authMethods: AuthMethod[],
  overrides?: Record<string, unknown> | null
): number {
  return authMethods.reduce(
    (sum, m) => sum + costCentsForMethod(m, overrides),
    0
  );
}

/**
 * Orçamento mensal em centavos. Prioridade: override per-org (quando informado)
 * → env global CLICKSIGN_MONTHLY_BUDGET_CENTS → default R$100. O `orgBudgetCents`
 * vem de OrgSignatureSettings.monthlyBudgetCents (null = usa o global).
 */
export function getMonthlyBudgetCents(orgBudgetCents?: number | null): number {
  if (
    typeof orgBudgetCents === "number" &&
    Number.isFinite(orgBudgetCents) &&
    orgBudgetCents > 0
  ) {
    return orgBudgetCents;
  }
  const raw = process.env.CLICKSIGN_MONTHLY_BUDGET_CENTS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}
