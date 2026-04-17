import { NextRequest, NextResponse } from "next/server";
import { processOcrQueue } from "@/lib/ai/ocr-worker";

export const runtime = "nodejs";
// Worker precisa de tempo suficiente pra processar 30 docs × 15s = 450s max.
// Vercel Pro maxDuration = 300s (5min). Worker picks 30 / concurrency 3 =
// ~10 rounds × 15s = 150s. Ok.
export const maxDuration = 300;

/**
 * GET /api/cron/ocr-queue
 *
 * Phase F.I-α — cron backup de OCR. Chamado a cada 1 min pelo Vercel Cron
 * (ver vercel.json). Pega attachments órfãos com:
 *   - status="queued" (upload retornou ack mas fire-and-forget não disparou)
 *   - status="extracting" com extractingStartedAt > 3min atrás (worker morreu
 *     no meio — stale lock recovery)
 *
 * Seguro pra rodar em paralelo com fire-and-forget: claim atômico via
 * updateMany evita double-processing.
 *
 * Opcional: proteger com CRON_SECRET header para evitar invocação externa.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await processOcrQueue();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron ocr-queue] failed:", msg);
    return NextResponse.json(
      { ok: false, error: msg.slice(0, 200) },
      { status: 500 }
    );
  }
}
