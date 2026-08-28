// Cap de custo DIÁRIO por org do revisor pós-geração.
//
// Diferente da ingestão (cap por RUN — um lote, um teto), a revisão é uma
// chamada pequena por contrato gerado, o dia inteiro: o teto que faz sentido
// é por org/dia. A fonte do gasto é o próprio AIUsage (operation
// "contract_review"), então não há acumulador novo para manter — e o modo de
// falha "modelo fora do PRICING grava custo zero e desliga o cap em silêncio"
// é vigiado com um warn no reviewer.
//
// Env lida A CADA chamada (mesma alavanca sem deploy do runMaxUsd da
// ingestão). Estourou → o run marca `skipped` no LLM, mas os checks
// determinísticos rodam mesmo assim: são grátis.
import { prisma } from "@/lib/db/prisma";

export const DEFAULT_REVIEW_DAILY_MAX_USD = 2;

export function reviewDailyMaxUsd(): number {
  const raw = Number(process.env.CONTRACT_REVIEW_DAILY_MAX_USD);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_REVIEW_DAILY_MAX_USD;
}

/** Início do dia corrente em UTC — dia de faturamento estável entre regiões. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function reviewSpentTodayUsd(orgId: string, now = new Date()): Promise<number> {
  const sum = await prisma.aIUsage.aggregate({
    where: {
      orgId,
      operation: "contract_review",
      createdAt: { gte: utcDayStart(now) },
    },
    _sum: { estimatedCostUsd: true },
  });
  const n = Number(sum._sum.estimatedCostUsd ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface ReviewBudgetCheck {
  withinCap: boolean;
  spentUsd: number;
  capUsd: number;
}

export async function checkReviewDailyCap(
  orgId: string,
  now = new Date()
): Promise<ReviewBudgetCheck> {
  const capUsd = reviewDailyMaxUsd();
  const spentUsd = await reviewSpentTodayUsd(orgId, now);
  return { withinCap: spentUsd < capUsd, spentUsd, capUsd };
}
