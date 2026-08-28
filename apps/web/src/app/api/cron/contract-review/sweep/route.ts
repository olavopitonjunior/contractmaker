import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { advanceReviewRun } from "@/lib/contract-review/executor";
import {
  REVIEW_STALE_MS,
  isClaimable,
  type ReviewStatus,
} from "@/lib/contract-review/review-state";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET/POST /api/cron/contract-review/sweep — sweeper da revisão pós-geração.
 *
 * Rede de segurança, não motor: o caminho normal é o enqueue da geração
 * disparar o /advance na hora. O sweeper pega o que sobrou — deploy sem
 * CRON_SECRET no enqueue, fetch que falhou, worker que morreu no meio (claim
 * stale). Roda a cada 5 min (vercel.json).
 *
 * O cap por varredura limita o dano de uma fila anômala; a fila continua na
 * próxima varredura. O claim atômico do executor torna concorrência com o
 * /advance direto inofensiva.
 */
const MAX_RUNS_PER_SWEEP = Number(process.env.CONTRACT_REVIEW_SWEEP_MAX ?? "5");

const CRON_PATH = "/api/cron/contract-review/sweep";

async function sweep(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  // Gate de staging (lição D13 da ingestão: cron fora do allowlist = corrente
  // morta em silêncio). Este path ENTRA no default allowlist — ver staging.ts.
  if (!(await isCronAllowedInStaging(CRON_PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: CRON_PATH });
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - REVIEW_STALE_MS);
  const candidates = await prisma.contractReviewRun.findMany({
    where: {
      OR: [
        { status: "queued" },
        { status: "reviewing", startedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: MAX_RUNS_PER_SWEEP,
    select: { id: true, status: true, startedAt: true },
  });

  const results = [] as Array<{ runId: string; status: string; claimed: boolean }>;
  for (const run of candidates) {
    // Filtro em memória espelha o claim (isClaimable) — o executor re-checa
    // atomicamente de qualquer forma.
    if (!isClaimable({ status: run.status as ReviewStatus, startedAt: run.startedAt }, now)) {
      continue;
    }
    const result = await advanceReviewRun(run.id);
    results.push({ runId: result.runId, status: result.status, claimed: result.claimed });
  }

  return NextResponse.json({ swept: results.length, results });
}

export async function GET(req: NextRequest) {
  return sweep(req);
}

export async function POST(req: NextRequest) {
  return sweep(req);
}
