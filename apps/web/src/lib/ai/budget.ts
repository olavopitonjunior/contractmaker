/**
 * Budget de tokens IA por contrato.
 *
 * Estilo do `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (certidões) e do
 * `getMonthlyBudgetCents` (Clicksign), mas escopado a um contrato específico.
 * Soma todos os `AIUsage.totalTokens` registrados para o contrato e compara
 * com o teto configurado em `CONTRACT_AI_TOKEN_BUDGET` (default 200_000).
 *
 * Aplicação: chat agent (`runContractAgent`) e passive analysis
 * (`runPassiveAnalysis`) chamam `assertContractBudget` antes de gastar IA.
 * Quando estourado, retornam mensagem amigável em vez de chamar Anthropic.
 *
 * Calibração de 200k tokens (~$0.50 USD em Sonnet 4 sem cache):
 *   - Contrato típico: 8k tokens/turn × 50 turns = 400k. Limite mais agressivo
 *     que isso (200k = ~25 turns) força o usuário a aprovar antes de continuar
 *     iterando, e/ou a comprar limite extra.
 *   - Passive analysis: ~3k tokens/run. 200k cobre ~65 análises por contrato.
 *   - Após o cap de 50 ContractComment unresolved já bloquear novas passes,
 *     o budget é o backstop final.
 */

import { prisma } from "@/lib/db/prisma";

export const DEFAULT_CONTRACT_TOKEN_BUDGET = 200_000;

export class ContractBudgetExceededError extends Error {
  constructor(
    public readonly spent: number,
    public readonly budget: number
  ) {
    super(
      `Orçamento de IA do contrato esgotado: ${spent.toLocaleString("pt-BR")} / ${budget.toLocaleString("pt-BR")} tokens. Aprove o contrato ou aumente o limite em CONTRACT_AI_TOKEN_BUDGET.`
    );
    this.name = "ContractBudgetExceededError";
  }
}

export interface BudgetStatus {
  ok: boolean;
  spent: number;
  budget: number;
  pct: number;
  /** Tokens restantes (>= 0). */
  remaining: number;
}

export function getBudgetCap(): number {
  const raw = process.env.CONTRACT_AI_TOKEN_BUDGET?.trim();
  if (!raw) return DEFAULT_CONTRACT_TOKEN_BUDGET;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTRACT_TOKEN_BUDGET;
}

export async function getContractTokensSpent(contractId: string): Promise<number> {
  const agg = await prisma.aIUsage.aggregate({
    where: { contractId },
    _sum: { totalTokens: true },
  });
  // totalTokens é populado por recordAIUsage; em rows antigos pode ser 0 se
  // só prompt+completion estiveram setados. Fallback soma os pares.
  const total = agg._sum.totalTokens ?? 0;
  if (total > 0) return total;
  const fallback = await prisma.aIUsage.aggregate({
    where: { contractId },
    _sum: { promptTokens: true, completionTokens: true },
  });
  return (fallback._sum.promptTokens ?? 0) + (fallback._sum.completionTokens ?? 0);
}

export async function getContractBudgetStatus(contractId: string): Promise<BudgetStatus> {
  const budget = getBudgetCap();
  const spent = await getContractTokensSpent(contractId);
  const pct = budget > 0 ? Math.min(1, spent / budget) : 0;
  const remaining = Math.max(0, budget - spent);
  return { ok: spent < budget, spent, budget, pct, remaining };
}

/**
 * Lança `ContractBudgetExceededError` se o contrato já esgotou o budget. Use
 * antes de cada chamada IA — não no meio. As funções consumidoras (chat /
 * passive) traduzem a exceção em resposta amigável.
 */
export async function assertContractBudget(contractId: string): Promise<BudgetStatus> {
  const status = await getContractBudgetStatus(contractId);
  if (!status.ok) {
    throw new ContractBudgetExceededError(status.spent, status.budget);
  }
  return status;
}
