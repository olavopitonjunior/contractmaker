import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { classifyAndExtract, humanizeOcrError } from "@/lib/ai/ocr";
import { suggestAssignment } from "@/lib/forms/extracted-to-form";
import { suggestLocacaoAssignment } from "@/lib/forms/extracted-to-form-locacao";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** OCR só roda em PDF e imagens (Gemini). Demais tipos ficam só armazenados. */
function isOcrableMime(mime: string): boolean {
  return mime === "application/pdf" || mime.startsWith("image/");
}

/**
 * POST /api/deals/:dealId/attachments/:attachmentId/extract
 *
 * Roda OCR (Gemini) sob demanda num DealAttachment da pasta do deal e PERSISTE
 * o resultado em `extractedData = { fields, confidence, category, assignment }`,
 * pra o card da aba Documentos exibir os campos (e o usuário aplicar depois).
 *
 * Síncrono (DealAttachment não tem máquina de status como FormAttachment) — o
 * cliente mostra spinner enquanto o request está em voo. Seletivo: o usuário
 * escolhe quais documentos extrair (controle de custo de tokens).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string; attachmentId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "documents:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { orgId: true, dataJson: true } },
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

  // Escopo do gerente + DEAL_EDIT (extração grava extractedData no anexo).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    via: apiAuth.ident.via,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.attachmentId },
    select: { id: true, dealId: true, url: true, mime: true, category: true, extractedData: true },
  });
  if (!attachment || attachment.dealId !== deal.id) {
    return NextResponse.json(
      { error: "Anexo não encontrado neste deal" },
      { status: 404 }
    );
  }

  if (!isOcrableMime(attachment.mime)) {
    return NextResponse.json(
      { error: `Tipo ${attachment.mime} não suporta leitura por IA (apenas PDF e imagens)` },
      { status: 415 }
    );
  }

  let buffer: Buffer;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Falha ao baixar anexo (${res.status})` },
        { status: 502 }
      );
    }
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: `Falha ao baixar anexo: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  let extraction;
  try {
    extraction = await classifyAndExtract(
      buffer.toString("base64"),
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
    return NextResponse.json({ error: humanizeOcrError(raw) }, { status: 502 });
  }

  const current = (attachment.extractedData as Record<string, unknown> | null) ?? {};
  const dataJson = (deal.form?.dataJson as Record<string, unknown> | null) ?? {};
  // Sugestão de slot por esteira: deal de locação tem shape próprio
  // (locadores/locatarios/garantia.fiador) — o suggest de venda devolvia
  // sempre "outro" e o doc nunca era classificado.
  const suggested =
    deal.kind === "locacao"
      ? suggestLocacaoAssignment(
          extraction.documentType,
          extraction.fields,
          {
            locadores: Array.isArray(dataJson.locadores)
              ? (dataJson.locadores as Array<Record<string, unknown>>)
              : [],
            locatarios: Array.isArray(dataJson.locatarios)
              ? (dataJson.locatarios as Array<Record<string, unknown>>)
              : [],
            garantia: (dataJson.garantia ?? undefined) as
              | { tipo?: string; fiador?: Record<string, unknown> }
              | undefined,
          },
          []
        )
      : suggestAssignment(
          extraction.documentType,
          extraction.fields,
          {
            vendedores: Array.isArray(dataJson.vendedores)
              ? (dataJson.vendedores as Array<Record<string, unknown>>)
              : [],
            compradores: Array.isArray(dataJson.compradores)
              ? (dataJson.compradores as Array<Record<string, unknown>>)
              : [],
            imoveis: Array.isArray(dataJson.imoveis)
              ? (dataJson.imoveis as Array<Record<string, unknown>>)
              : [],
          },
          []
        );
  // Preserva o assignment manual (usuário pode ter movido via "Mover para…").
  const assignment =
    (current.assignment as { kind: string; index: number } | undefined) ?? suggested;

  const extractedData = {
    ...current,
    fields: extraction.fields,
    confidence: extraction.confidence,
    category: extraction.documentType,
    assignment,
  };

  await prisma.dealAttachment.update({
    where: { id: attachment.id },
    data: {
      extractedData,
      // Preenche a category-coluna se ainda vazia (sem sobrescrever classificação manual).
      ...(attachment.category ? {} : { category: extraction.documentType }),
    },
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "ATTACHMENT_EXTRACT",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "DealAttachment",
      metadata: mergeAuditMetadata(
        { dealId: deal.id, documentType: extraction.documentType, confidence: extraction.confidence },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json({
    attachmentId: attachment.id,
    category: extraction.documentType,
    fields: extraction.fields,
    confidence: extraction.confidence,
    assignment,
  });
}
