import type { AuthMethod } from "./types";

// Custo aproximado por assinatura em centavos de R$. ESTIMATIVA INTERNA, não
// exibida em tela: alimenta só `Envelope.costCents` (telemetria/histórico).
// Nunca foi conferida com o plano real de nenhuma conta — foi essa tabela,
// somada a um teto mensal, que produziu o falso "orçamento atingido".
// Não usar para barrar envio nem para mostrar valor ao usuário.
export const CLICKSIGN_COST_CENTS: Record<AuthMethod, number> = {
  email: 150,
  whatsapp: 250,
  selfie: 900,
  icp_brasil: 350,
};

/** Custo por método efetivo: override per-org (OrgSignatureSettings.costOverridesJson)
 *  sobre a tabela global hardcoded. `overrides` chega como Json do banco.
 *
 *  A coluna continua LIDA, mas desde 08/2026 não tem mais escritor: o card de
 *  custo saiu de Configurações. Quem precisar ajustar um override faz por SQL.
 *  Não confundir com órfã. */
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

// Não existe mais orçamento mensal. `getMonthlyBudgetCents` (override per-org →
// CLICKSIGN_MONTHLY_BUDGET_CENTS → default R$100) barrava envio comparando o
// gasto acumulado contra um teto que a plataforma inventava — o envio morria com
// "R$ 93 de R$ 100" sem que o plano da conta ClickSign tivesse estourado nada.
// Quem sabe se há envelope disponível é a ClickSign: ver lib/clicksign/quota.ts.
// A coluna `OrgSignatureSettings.monthlyBudgetCents` e a env continuam no lugar,
// apenas sem leitor (limpeza é migration própria).
