import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { classifyAndExtract, humanizeOcrError } from "@/lib/ai/ocr";
import {
  scoreFields,
  SUPPORTED_DOCUMENT_TYPES,
} from "@/lib/extraction/field-schemas";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

const bodySchema = z.object({
  attachmentId: z.string().min(1),
  documentType: z.enum(SUPPORTED_DOCUMENT_TYPES as [string, ...string[]]).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * POST /api/deals/:dealId/extract-fields
 *
 * Newton-friendly Bearer endpoint pra extração estruturada de documento.
 * Wraps `classifyAndExtract` (Gemini OCR) e enriquece o resultado com score
 * por campo via field-schemas (regex de validação + presença + partial markers).
 *
 * Diferença pra OCR existente do form (`/api/forms/[token]/...`):
 *   - Aqui o input é um `DealAttachment` que já existe (uploaded via Newton
 *     ou form público) — não recebe upload novo.
 *   - Output tem `fields[key] = { value, confidence, needsReview, reason }`
 *     em vez de `fields[key] = string` opaco.
 *   - Lista `lowConfidenceFields` e `missingRequiredFields` separadas pra
 *     Newton decidir o que confirmar com humano antes de gravar.
 *
 * Sem HITL — extração é leitura, não escrita. Newton recebe os campos e
 * decide via persona OCR.md o que fazer (recitar, confirmar, gravar via
 * `fill_form` separado).
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
  const { attachmentId, documentType: forcedType } = parsed.data;

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

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    via: apiAuth.ident.via,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, dealId: true, url: true, mime: true, filename: true },
  });
  if (!attachment || attachment.dealId !== deal.id) {
    return NextResponse.json(
      { error: "Attachment não encontrado neste deal" },
      { status: 404 }
    );
  }

  if (!ALLOWED_MIMES.includes(attachment.mime)) {
    return NextResponse.json(
      {
        error: `Mime ${attachment.mime} não suportado para OCR (suporta ${ALLOWED_MIMES.join(", ")})`,
      },
      { status: 415 }
    );
  }

  let buffer: Buffer;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Falha ao baixar attachment (${res.status})` },
        { status: 502 }
      );
    }
    const arr = await res.arrayBuffer();
    buffer = Buffer.from(arr);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Falha ao baixar attachment: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }

  const base64 = buffer.toString("base64");
  let extraction;
  try {
    extraction = await classifyAndExtract(
      base64,
      attachment.mime,
      {
        orgId: apiAuth.org.id,
        userId: apiAuth.actor.effectiveUserId,
        contractId: null,
      },
      { buffer }
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: humanizeOcrError(raw) },
      { status: 502 }
    );
  }

  const effectiveType = forcedType ?? extraction.documentType;
  const scored = scoreFields(effectiveType, extraction.fields);

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "ATTACHMENT_EXTRACT",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "DealAttachment",
      metadata: mergeAuditMetadata(
        {
          dealId: deal.id,
          documentType: effectiveType,
          detectedType: extraction.documentType,
          globalConfidence: extraction.confidence,
          lowConfidenceCount: scored.lowConfidenceFields.length,
          missingRequiredCount: scored.missingRequiredFields.length,
        },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json({
    attachmentId: attachment.id,
    filename: attachment.filename,
    documentType: effectiveType,
    detectedType: extraction.documentType,
    typeOverridden: forcedType !== undefined && forcedType !== extraction.documentType,
    globalConfidence: extraction.confidence,
    fields: scored.fields,
    lowConfidenceFields: scored.lowConfidenceFields,
    missingRequiredFields: scored.missingRequiredFields,
    unknownFields: scored.unknownFields,
  });
}
