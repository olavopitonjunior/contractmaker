import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { applyExtractedToDataJson } from "@/lib/forms/apply-extracted-to-datajson";
import type { Assignment } from "@/lib/forms/extracted-to-form";
import {
  deriveDealMetadata,
  deriveLocacaoDealMetadata,
} from "@/lib/contracts/derive-deal-metadata";

export const runtime = "nodejs";

const bodySchema = z.object({
  assignment: z
    .object({ kind: z.string(), index: z.number().int().min(0) })
    .optional(),
});

/**
 * POST /api/deals/:dealId/attachments/:attachmentId/apply
 *
 * Aplica os campos já extraídos por OCR (em `extractedData.fields`) sobre o
 * `dataJson` do SalesForm vinculado — autofill de vendedores/compradores/imóvel,
 * reaproveitando a lógica do form público via `applyExtractedToDataJson`.
 *
 * Passo EXPLÍCITO (não automático no OCR): o usuário confere/corrige a pasta no
 * dropdown "Mover para…" e então aplica. `skipIfDirty: true` nunca sobrescreve
 * campo já preenchido. Re-deriva `Deal.value` (NÃO o título — esse é editável à
 * parte e é a fonte de verdade).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string; attachmentId: string } }
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

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { id: true, orgId: true, dataJson: true, title: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  const dealKind = deal?.kind === "locacao" ? ("locacao" as const) : ("venda" as const);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!deal.form) {
    return NextResponse.json(
      { error: "Negócio sem formulário vinculado — não há onde preencher os dados" },
      { status: 400 }
    );
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.attachmentId },
    select: { id: true, dealId: true, extractedData: true },
  });
  if (!attachment || attachment.dealId !== deal.id) {
    return NextResponse.json(
      { error: "Anexo não encontrado neste deal" },
      { status: 404 }
    );
  }

  const extracted = (attachment.extractedData as Record<string, unknown> | null) ?? {};
  const fields = (extracted.fields as Record<string, unknown> | null) ?? null;
  const category = (extracted.category as string | null) ?? null;
  if (!fields) {
    return NextResponse.json(
      { error: "Anexo ainda não foi lido pela IA — extraia primeiro" },
      { status: 400 }
    );
  }

  const assignment: Assignment =
    (parsed.data.assignment as Assignment | undefined) ??
    (extracted.assignment as Assignment | undefined) ?? { kind: "outro", index: 0 };

  const { merged, filled } = applyExtractedToDataJson(
    deal.form.dataJson as Record<string, unknown> | null,
    { category, fields },
    assignment,
    { skipIfDirty: true, kind: dealKind }
  );

  // Derive por kind; `?? deal.value` evita zerar o valor existente quando o
  // dataJson não tem o campo (deriveDealMetadata de venda sobre dataJson de
  // locação devolvia null e apagava o aluguel do card).
  const derive = dealKind === "locacao" ? deriveLocacaoDealMetadata : deriveDealMetadata;
  const { value, clientName } = derive(merged, {
    formTitle: deal.form.title,
    fallbackTitle: deal.title,
  });

  await prisma.$transaction([
    prisma.salesForm.update({
      where: { id: deal.form.id },
      data: { dataJson: merged as Prisma.InputJsonValue },
    }),
    prisma.deal.update({
      where: { id: deal.id },
      data: { value: value ?? deal.value, ...(clientName ? { clientName } : {}) },
    }),
    prisma.dealAttachment.update({
      where: { id: attachment.id },
      data: {
        extractedData: { ...extracted, assignment, applied: true } as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "DEAL_UPDATE",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: mergeAuditMetadata(
        { dealId: deal.id, attachmentId: attachment.id, autofillFilled: filled },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json({ filled });
}
