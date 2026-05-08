import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getEnvelope } from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";
import { uploadBufferToStorage } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/clicksign/sync-envelopes
 * Fallback diário pra reconciliar envelopes "running" que não tiveram
 * webhook recente. Marca closed/canceled conforme estado da Clicksign.
 *
 * **REDUNDANTE desde 2026-05-08** — webhook agora funciona (lookup por
 * `documentClicksignId` em vez de `envelope.id`). Botão Atualizar em
 * `/sync` cobre casos manuais. Mantido como suspensórios caso ClickSign
 * tenha downtime de webhook prolongado. Considere remover se logs
 * mostrarem 0 drift por 30+ dias.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h
  const envelopes = await prisma.envelope.findMany({
    where: {
      status: "running",
      updatedAt: { lt: cutoff },
      clicksignId: { not: null },
    },
    take: 50,
  });

  let synced = 0;
  let drifted = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const env of envelopes) {
    if (!env.clicksignId) continue;
    try {
      const resp = await getEnvelope(env.clicksignId);
      const data = (resp as { data?: { attributes?: { status?: string } } })
        .data;
      const remoteStatus = data?.attributes?.status;
      if (!remoteStatus) continue;

      if (remoteStatus === "closed") {
        await prisma.envelope.update({
          where: { id: env.id },
          data: { status: "closed", closedAt: new Date() },
        });
        await prisma.envelopeEvent.create({
          data: {
            envelopeId: env.id,
            eventName: "close",
            payload: { source: "cron-sync", remoteStatus },
            source: "cron",
          },
        });
        const signedUrl = extractSignedUrl(resp);
        if (signedUrl) void downloadSignedPdf(env.id, signedUrl);
        drifted += 1;
      } else if (remoteStatus === "canceled") {
        await prisma.envelope.update({
          where: { id: env.id },
          data: { status: "canceled", canceledAt: new Date() },
        });
        await prisma.envelopeEvent.create({
          data: {
            envelopeId: env.id,
            eventName: "cancel",
            payload: { source: "cron-sync", remoteStatus },
            source: "cron",
          },
        });
        drifted += 1;
      } else {
        // Mantém running mas atualiza updatedAt pra não cair de novo no sweep.
        await prisma.envelope.update({
          where: { id: env.id },
          data: { updatedAt: new Date() },
        });
      }
      synced += 1;
    } catch (err) {
      const msg = err instanceof ClicksignError ? err.message : String(err);
      errors.push({ id: env.id, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    examined: envelopes.length,
    synced,
    drifted,
    errorCount: errors.length,
    errors: errors.slice(0, 10),
  });
}

function extractSignedUrl(resp: unknown): string | null {
  const included = (resp as { included?: Array<{ attributes?: Record<string, unknown> }> })
    .included;
  if (!Array.isArray(included)) return null;
  for (const item of included) {
    const downloads = item.attributes?.downloads as
      | { signed_file_url?: string }
      | undefined;
    if (downloads?.signed_file_url) return downloads.signed_file_url;
  }
  return null;
}

async function downloadSignedPdf(envelopeId: string, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const stored = await uploadBufferToStorage({
      bucket: process.env.S3_BUCKET,
      key: `envelopes/${envelopeId}/signed.pdf`,
      body: buf,
      contentType: "application/pdf",
    });
    await prisma.envelope.update({
      where: { id: envelopeId },
      data: { signedDocumentUrl: stored },
    });
  } catch (err) {
    console.error("[clicksign cron] falha download PDF assinado:", err);
  }
}
