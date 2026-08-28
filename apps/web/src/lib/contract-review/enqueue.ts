// Enfileiramento da revisão pós-geração.
//
// Chamado num `waitUntil` do hook da geração — a resposta já foi enviada e um
// LLM não cabe ali. Cria o run `queued` e dispara a rota /advance com o
// CRON_SECRET (mesmo desenho de lib/ingestion/chain.ts); sem secret ou com o
// fetch falhando, o run fica de pé e o sweeper o pega em ≤5 min. NUNCA lança:
// falhar em revisar não pode falhar a geração.
import { prisma } from "@/lib/db/prisma";
import { isContractReviewEnabled } from "./guard";

export interface EnqueueContractReviewInput {
  contractId: string;
  orgId: string;
  dealKind: string;
  /**
   * Origem para a URL do /advance. O hook da geração não tem a request em
   * mãos (roda fundo em lib/services), então cai nas envs públicas — o
   * fallback é o sweeper, que não depende de URL nenhuma.
   */
  origin?: string;
}

export interface EnqueueContractReviewResult {
  enqueued: boolean;
  runId?: string;
  reason?: "feature-disabled" | "create-failed";
  chained: boolean;
}

export async function enqueueContractReview(
  input: EnqueueContractReviewInput
): Promise<EnqueueContractReviewResult> {
  try {
    const enabled = await isContractReviewEnabled(input.orgId, input.dealKind);
    if (!enabled) return { enqueued: false, reason: "feature-disabled", chained: false };

    const run = await prisma.contractReviewRun.create({
      data: { contractId: input.contractId, orgId: input.orgId },
      select: { id: true },
    });

    const chained = await chainReviewAdvance(run.id, input.origin);
    return { enqueued: true, runId: run.id, chained };
  } catch (err) {
    console.error("[contract-review] enqueue falhou:", err);
    return { enqueued: false, reason: "create-failed", chained: false };
  }
}

/** URL absoluta do /advance do run. */
export function reviewAdvanceUrl(origin: string, runId: string): string {
  return `${origin.replace(/\/+$/, "")}/api/contracts/review-runs/${runId}/advance`;
}

/**
 * Dispara o /advance imediatamente (latência de segundos em vez de esperar o
 * cron). Best-effort: sem CRON_SECRET ou sem base pública → false, e o sweeper
 * assume.
 */
async function chainReviewAdvance(runId: string, origin?: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const base = origin || process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL;
  if (!secret || !base) return false;
  try {
    await fetch(reviewAdvanceUrl(base, runId), {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    return true;
  } catch (err) {
    console.warn(`[contract-review] disparo do run ${runId} falhou (sweeper assume):`, err);
    return false;
  }
}
