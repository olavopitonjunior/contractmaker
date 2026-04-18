import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { processOcrQueue } from "@/lib/ai/ocr-worker";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/forms/:token/attachments/:id/retry
 *
 * Phase F.I-α + fix rate limit — retry manual de 1 attachment específico.
 * Libera o lock se estiver travado ("extracting" há muito tempo) e reinsere
 * na fila (status="queued"), depois dispara worker imediato.
 *
 * UX: cliente mostra botão "Tentar novamente" nos cards em "extracting"
 * parados > 60s ou "failed" com categoria recuperável.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string; id: string } }
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: { id: true, orgId: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const attachment = await prisma.formAttachment.findUnique({
    where: { id: params.id },
    select: { id: true, formId: true, status: true },
  });
  if (!attachment || attachment.formId !== form.id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Reseta para queued — worker (ou cron) vai pegar. Limpa extractError e
  // lock para recomeçar do zero.
  await prisma.formAttachment.update({
    where: { id: params.id },
    data: {
      status: "queued",
      extractingStartedAt: null,
      extractError: null,
    },
  });

  // Dispara worker fire-and-forget — não espera OCR terminar pra responder
  void processOcrQueue({ formId: form.id }).catch((err) => {
    console.error("[attachment retry] worker dispatch failed:", err);
  });

  return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
}
