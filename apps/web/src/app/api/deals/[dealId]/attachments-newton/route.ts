import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024;

// Armazenamento aceita QUALQUER tipo de documento (não só imagem/PDF) — a pasta
// do deal guarda contratos avulsos, planilhas, etc. OCR (PDF/imagem) e assinatura
// (PDF) gateiam o tipo nas suas próprias rotas/UI. Mantemos o cap de 10MB e a
// sanitização do filename. Validamos só o SHAPE do mime (`tipo/subtipo`).
const MIME_SHAPE = /^[\w.+-]+\/[\w.+-]+$/;

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255).regex(MIME_SHAPE, "mime inválido"),
  base64Data: z.string().min(1),
  category: z.string().optional(),
});

/**
 * POST /api/deals/:dealId/attachments-newton
 *
 * Newton-friendly Bearer twin do upload em `/api/forms/[token]/attachments`.
 * Aceita JSON com base64 ao invés de multipart (Newton não produz multipart
 * trivialmente). Faz upload pro Vercel Blob, persiste como `DealAttachment`,
 * com SHA-256 cache pre-warm.
 *
 * Sem HITL — operação reversível via DELETE no attachment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "documents:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { filename, mime, base64Data, category } = parsed.data;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { orgId: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Decodifica base64 → Buffer
  const cleaned = base64Data.replace(/^data:[^;]+;base64,/, "");
  let buffer: Buffer;
  try {
    buffer = Buffer.from(cleaned, "base64");
  } catch {
    return NextResponse.json({ error: "base64Data inválido" }, { status: 400 });
  }
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Conteúdo vazio" }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `Excede limite de ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 400 }
    );
  }

  // SHA-256 persistido (dedupe por conteúdo) + metadata de audit.
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  // Dedupe por conteúdo: mesmo arquivo reenviado pro mesmo deal não duplica
  // linha nem reuploada. Idempotente (Newton pode reenviar em retry).
  const existing = await prisma.dealAttachment.findFirst({
    where: { dealId: deal.id, contentHash },
  });
  if (existing) {
    return NextResponse.json(
      {
        id: existing.id,
        filename: existing.filename,
        mime: existing.mime,
        url: existing.url,
        category: existing.category,
        createdAt: existing.createdAt,
        deduped: true,
      },
      { status: 200 }
    );
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Path scheme + STAGING_MODE/normalizeKey via helper compartilhado (antes
  // chamava put() direto, ignorando o prefixo staging/ e divergindo dos demais).
  const key = `deal-attachments/${deal.id}/${Date.now()}-${safeName}`;

  let blobUrl: string;
  try {
    blobUrl = await uploadBufferToStorage({
      bucket: process.env.S3_BUCKET,
      key,
      body: buffer,
      contentType: mime,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Upload falhou: ${msg}` },
      { status: 500 }
    );
  }

  const attachment = await prisma.dealAttachment.create({
    data: {
      dealId: deal.id,
      filename,
      mime,
      url: blobUrl,
      category: category ?? null,
      byteSize: buffer.byteLength,
      contentHash,
    },
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "ATTACHMENT_UPLOAD",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "DealAttachment",
      metadata: mergeAuditMetadata(
        { dealId: deal.id, mime, bytes: buffer.length, contentHash },
        apiAuth.actor
      ),
    }
  );

  // F4 iteração 2026-05-17 — quando a category é certidão ou matrícula anexada,
  // dispara análise fire-and-forget: OCR estruturado → CertidaoJobLite sintético
  // → crossCheckCertidoes → ContractComment por finding. Não bloqueia o response.
  if (
    attachment.category &&
    (attachment.category.startsWith("certidao_") || attachment.category === "matricula_anexada")
  ) {
    void import("@/lib/services/manual-certidao-analysis").then(
      ({ analyzeManualCertidaoForDeal }) =>
        analyzeManualCertidaoForDeal(deal.id, attachment.id).catch((err) => {
          console.error("[attachments-newton] analyzeManualCertidaoForDeal falhou:", err);
        })
    );
  }

  return NextResponse.json(
    {
      id: attachment.id,
      filename: attachment.filename,
      mime: attachment.mime,
      url: attachment.url,
      category: attachment.category,
      createdAt: attachment.createdAt,
    },
    { status: 201 }
  );
}
