import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { triggerNewtonForRequest } from "@/lib/newton/trigger";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/newton-requests/sweep
 *
 * Motor de re-cobrança dos pedidos ao Newton. Substitui o lembrete por-pedido
 * (que falharia: `schedule_proactive_message` precisa do binário `openclaw`, que
 * só existe no container do gateway, não no sidecar onde roda o /run).
 *
 * A cada execução, pega pedidos ainda pendentes que não foram cobrados nas
 * últimas 24h e re-dispara o turn do Newton (kind "remind"). Cobre também os
 * "open" cujo trigger imediato falhou → funciona como safety-net.
 *
 * Guardas:
 *  - Janela 7h–22h America/Sao_Paulo (enforçada aqui, independente do agendador).
 *  - Throttle: lastNudgeAt < agora-24h (no máx. ~1 re-cobrança/dia por pedido).
 *  - TTL: ignora pedidos com mais de 14 dias (não persegue zumbi pra sempre).
 *  - Limite de 50 por execução.
 *
 * Schedule: de hora em hora (vercel.json). Auth: opcional via `CRON_SECRET`.
 */

const NUDGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 50;

/** Hora atual no fuso de São Paulo (UTC-3, sem horário de verão desde 2019). */
function saoPauloHour(now: Date): number {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/newton-requests/sweep"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/newton-requests/sweep" });
  }

  const now = new Date();
  const hour = saoPauloHour(now);
  if (hour < 7 || hour >= 22) {
    return NextResponse.json({ skipped: "fora da janela 7h-22h SP", hour });
  }

  const nudgeCutoff = new Date(now.getTime() - NUDGE_INTERVAL_MS);
  const ageCutoff = new Date(now.getTime() - MAX_AGE_MS);

  const candidates = await prisma.newtonRequest.findMany({
    where: {
      status: { in: ["open", "chasing", "awaiting_reply"] },
      createdAt: { gte: ageCutoff },
      OR: [{ lastNudgeAt: null }, { lastNudgeAt: { lt: nudgeCutoff } }],
    },
    orderBy: [{ priority: "desc" }, { lastNudgeAt: "asc" }, { createdAt: "asc" }],
    take: BATCH_LIMIT,
  });

  if (candidates.length === 0) {
    return NextResponse.json({ swept: 0, hour });
  }

  // Marca lastNudgeAt ANTES de disparar — garante o throttle de 1/dia mesmo se
  // o turn do Newton falhar/atrasar (o turn pode atualizar de novo via tool).
  await prisma.newtonRequest.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { lastNudgeAt: now },
  });

  for (const r of candidates) {
    waitUntil(
      triggerNewtonForRequest({
        dealId: r.dealId,
        requestId: r.id,
        ask: r.ask,
        targetType: r.targetType,
        targetRef: r.targetRef,
        targetLabel: r.targetLabel,
        // "open" nunca foi cobrado (trigger imediato falhou) → 1ª cobrança;
        // demais já estão em andamento → re-cobrança.
        kind: r.status === "open" ? "create" : "remind",
      })
    );
  }

  return NextResponse.json({ swept: candidates.length, hour });
}
