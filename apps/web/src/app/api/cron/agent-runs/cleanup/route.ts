import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/agent-runs/cleanup
 *
 * D5 — retenção do log AgentRun. Diário (vercel.json `0 4 * * *`). Deleta runs
 * mais antigos que `AGENT_RUN_RETENTION_DAYS` (default 180). Auth opcional via
 * `CRON_SECRET`. Mantém a tabela enxuta sem perder histórico recente para
 * análise/treino.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const days = Number(process.env.AGENT_RUN_RETENTION_DAYS) || 180;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.agentRun.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return NextResponse.json({ deleted: count, retentionDays: days });
}
