import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * Webhook do Google Drive: cada `files.watch` registrado posta aqui quando o
 * arquivo muda. Headers relevantes:
 *  - X-Goog-Channel-Id: channelId que registramos
 *  - X-Goog-Channel-Token: shared secret (validamos contra GOOGLE_WATCH_TOKEN)
 *  - X-Goog-Resource-State: "sync" (initial) | "update" | "trash" | "remove"
 *  - X-Goog-Resource-Id: id opaco do recurso assinado
 *
 * Setup manual (uma vez por contrato — chame `watchFile` em lib/google/watch.ts
 * passando esta URL):
 *   https://imobpro.ia.br/api/webhooks/google-drive
 *
 * E renove o watch antes do `googleWatchExpires` via cron job. Drive limita
 * cada channel a 7 dias.
 */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const channelToken = req.headers.get("x-goog-channel-token");
  const resourceState = req.headers.get("x-goog-resource-state");
  const resourceId = req.headers.get("x-goog-resource-id");

  const expectedToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
  if (expectedToken && channelToken !== expectedToken) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  if (!channelId) {
    return NextResponse.json({ error: "missing channel id" }, { status: 400 });
  }

  // Sync inicial (logo após watchFile) — ignorar.
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true, ignored: "sync" });
  }

  const contract = await prisma.contract.findFirst({
    where: { googleWatchChannel: channelId },
    select: { id: true, googleDocId: true },
  });

  if (!contract) {
    console.warn(`[drive-webhook] channel ${channelId} sem contract associado`);
    return NextResponse.json({ ok: true, unmatched: true });
  }

  await prisma.contractChangeLog.create({
    data: {
      contractId: contract.id,
      action: "google_doc_updated",
      summary: `Edição detectada no Google Doc (${resourceState})`,
      details: {
        resourceState,
        resourceId,
        channelId,
        timestamp: new Date().toISOString(),
      },
      source: "system",
    },
  });

  return NextResponse.json({ ok: true });
}

// Drive faz uma chamada GET de health-check ao registrar o watch — responder 200.
export async function GET() {
  return NextResponse.json({ ok: true, service: "google-drive-webhook" });
}
