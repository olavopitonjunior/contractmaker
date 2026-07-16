import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Renova Drive watches que expiram nas próximas 24h. Drive watch máx é 7 dias,
 * então com cron a cada 6h temos margem confortável.
 *
 * Auth via Authorization: Bearer <CRON_SECRET> (mesma convenção do
 * certidoes/poll-portal). Em Vercel, cron jobs já incluem esse header.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/google-watches/renew"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/google-watches/renew" });
  }

  const watchToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
  const webhookBase = (process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL)?.trim();
  if (!watchToken || !webhookBase) {
    return NextResponse.json({ error: "missing GOOGLE_WATCH_TOKEN or NEXTAUTH_URL" }, { status: 500 });
  }

  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const expiring = await prisma.contract.findMany({
    where: {
      googleDocId: { not: null },
      googleWatchExpires: { lt: cutoff },
      // Aprovados são readonly — não precisa de webhook de edição
      status: { not: "aprovado" },
    },
    select: {
      id: true,
      googleDocId: true,
      googleWatchChannel: true,
      googleWatchResource: true,
    },
    take: 100,
  });

  const { watchFile, unwatchChannel } = await import("@/lib/google/watch");
  const webhookUrl = `${webhookBase.replace(/\/$/, "")}/api/webhooks/google-drive`;

  const results: Array<{ contractId: string; ok: boolean; error?: string }> = [];

  for (const c of expiring) {
    try {
      // Best-effort: encerra o channel antigo (pode falhar se já expirado)
      if (c.googleWatchChannel && c.googleWatchResource) {
        try {
          await unwatchChannel(c.googleWatchChannel, c.googleWatchResource);
        } catch {
          // ignored — channel pode já ter expirado naturalmente
        }
      }

      const watch = await watchFile({
        fileId: c.googleDocId!,
        webhookUrl,
        token: watchToken,
      });

      await prisma.contract.update({
        where: { id: c.id },
        data: {
          googleWatchChannel: watch.channelId,
          googleWatchResource: watch.resourceId,
          googleWatchExpires: new Date(watch.expiration),
        },
      });
      results.push({ contractId: c.id, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron renew] Falha em contrato ${c.id}:`, msg);
      results.push({ contractId: c.id, ok: false, error: msg });
    }
  }

  return NextResponse.json({
    candidates: expiring.length,
    renewed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
