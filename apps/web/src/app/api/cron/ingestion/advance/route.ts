import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { prisma } from "@/lib/db/prisma";
import { advanceRun } from "@/lib/ingestion/run-executor";
import {
  AUTO_ADVANCE_STATUSES,
  RUN_STALE_MS,
} from "@/lib/ingestion/run-state";

export const runtime = "nodejs";
// Um run por vez, com o mesmo orçamento de fatia do /advance. O sweeper existe
// pra destravar, não pra ser o motor — o motor é o re-encadeamento.
export const maxDuration = 300;

const CRON_PATH = "/api/cron/ingestion/advance";

/** Quantos runs travados uma varredura destrava. */
const MAX_RUNS_PER_SWEEP = Number(process.env.INGESTION_SWEEP_MAX ?? "3");

/**
 * GET /api/cron/ingestion/advance
 *
 * Sweeper dos runs de ingestão travados. A corrente do `/advance` cobre o caso
 * normal; ela se rompe quando a função morre no meio da fatia (deploy, OOM,
 * timeout da Vercel) ou quando `CRON_SECRET` não estava disponível na hora do
 * re-encadeamento. Sem o sweeper, o lote ficaria parado esperando alguém abrir
 * a tela.
 *
 * Pega runs em estágio AUTOMÁTICO cujo claim está livre ou vencido — a mesma
 * condição que `advanceRun` reavalia atomicamente no `where` do update, então
 * rodar junto com a corrente é seguro: quem perder a corrida recebe
 * `claimed: false` e sai.
 *
 * `planning` e `awaiting_review` ficam FORA da varredura de propósito: um run
 * parado neles não está travado, está esperando (o planner da Fase A2 e a
 * revisão humana, respectivamente).
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging(CRON_PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: CRON_PATH });
  }

  try {
    const staleBefore = new Date(Date.now() - RUN_STALE_MS);
    const candidates = await prisma.ingestionRun.findMany({
      where: {
        status: { in: [...AUTO_ADVANCE_STATUSES] },
        OR: [{ startedAt: null }, { startedAt: { lt: staleBefore } }],
      },
      // O índice [status, updatedAt] existe pra esta consulta: o run mais
      // esquecido primeiro.
      orderBy: { updatedAt: "asc" },
      take: MAX_RUNS_PER_SWEEP,
      select: { id: true },
    });

    const results = [];
    for (const candidate of candidates) {
      // Sem `orgId`: a listagem acima é do próprio servidor, não veio de um
      // tenant. O claim atômico dentro de `advanceRun` é o que evita colidir
      // com uma corrente em andamento.
      results.push(await advanceRun({ runId: candidate.id }));
    }

    return NextResponse.json({
      ok: true,
      picked: candidates.length,
      runs: results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron ingestion/advance] failed:", msg);
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}
