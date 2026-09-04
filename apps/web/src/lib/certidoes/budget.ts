import type { Prisma } from "@prisma/client";

/**
 * Orçamento mensal de certidões — fonte ÚNICA (2026-09-02).
 *
 * Antes havia três defaults diferentes para `INFOSIMPLES_MONTHLY_BUDGET_CENTS`
 * (R$ 200 no executor e no monitor, R$ 50.000 na API que o dashboard/Newton
 * leem, R$ 50 na doc de deploy) e três contagens diferentes de "gasto do mês"
 * (só deals da org; só `orgId`; os dois com OR). O dashboard mostrava um teto
 * 250× maior do que o que realmente bloqueava o disparo.
 */

export type CertidoesProvider = "infosimples" | "serasa" | "fichacerta";

/** R$ 200,00 — o valor que sempre bloqueou de fato (executor). */
export const INFOSIMPLES_BUDGET_DEFAULT_CENTS = 20000;
/** R$ 5.000,00 — placeholder: o Serasa não está integrado (ver docs/certidoes-serasa.md). */
export const SERASA_BUDGET_DEFAULT_CENTS = 500000;
/**
 * R$ 3.000,00 — Ficha Certa Digital (análise de crédito na proposta). A conta é
 * POR IMOBILIÁRIA e pré-paga em créditos; este teto é o freio da plataforma
 * contra disparo em loop, não o saldo da conta (esse é `GET /credits`).
 */
export const FICHACERTA_BUDGET_DEFAULT_CENTS = 300000;

const BUDGET_ENV: Record<CertidoesProvider, string> = {
  infosimples: "INFOSIMPLES_MONTHLY_BUDGET_CENTS",
  serasa: "SERASA_MONTHLY_BUDGET_CENTS",
  fichacerta: "FICHACERTA_MONTHLY_BUDGET_CENTS",
};
const BUDGET_DEFAULT: Record<CertidoesProvider, number> = {
  infosimples: INFOSIMPLES_BUDGET_DEFAULT_CENTS,
  serasa: SERASA_BUDGET_DEFAULT_CENTS,
  fichacerta: FICHACERTA_BUDGET_DEFAULT_CENTS,
};

export function monthlyBudgetCents(provider: CertidoesProvider): number {
  const raw = process.env[BUDGET_ENV[provider]];
  const fallback = BUDGET_DEFAULT[provider];
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Primeiro instante do mês corrente (fuso do servidor, como sempre foi). */
export function firstOfCurrentMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * `where` do gasto do mês de uma org num provider. Conta jobs de deal (org via
 * `form.orgId`) E jobs sem deal (ad-hoc e LeaseClient, `orgId` direto) — cada
 * linha uma vez (o OR não duplica). É a mesma cláusula para bloquear o
 * disparo, para o monitor e para a API do dashboard.
 */
export function monthlySpendWhere(
  orgId: string,
  provider: CertidoesProvider,
  since: Date = firstOfCurrentMonth()
): Prisma.CertidaoJobWhereInput {
  return {
    createdAt: { gte: since },
    provider,
    OR: [{ deal: { form: { orgId } } }, { orgId }],
  };
}
