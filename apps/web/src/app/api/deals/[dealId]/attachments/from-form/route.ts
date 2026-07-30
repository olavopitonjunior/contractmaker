import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

const bodySchema = z.object({
  formAttachmentId: z.string().min(1),
});

/**
 * POST /api/deals/:dealId/attachments/from-form
 *
 * Copia (sob demanda) um FormAttachment — documento enviado pelo formulário
 * público — para um DealAttachment, tornando-o cidadão de 1ª classe na pasta
 * do negócio (movível entre pastas e elegível a assinatura). A cópia no
 * finalize do form (`/api/forms/[token]`) cobre o caso feliz; este endpoint
 * cobre docs subidos depois do finalize ou por outro caminho.
 *
 * Idempotente: se já existe um DealAttachment com a mesma `url`, retorna ele.
 * Preserva mime/category/extractedData (assignment/fields).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { id: true, formId: true, pipeline: { select: { orgId: true } } },
  });
  if (!deal) {
    return NextResponse.json({ error: "Negócio não encontrado" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  const formAtt = await prisma.formAttachment.findUnique({
    where: { id: parsed.data.formAttachmentId },
  });
  if (!formAtt) {
    return NextResponse.json(
      { error: "Documento do formulário não encontrado" },
      { status: 404 }
    );
  }
  // Escopo: o anexo precisa pertencer ao formulário deste negócio.
  if (!deal.formId || formAtt.formId !== deal.formId) {
    return NextResponse.json(
      { error: "Documento não pertence a este negócio" },
      { status: 400 }
    );
  }

  // Idempotência por url — não duplica se já foi copiado (finalize ou clique anterior).
  const existing = await prisma.dealAttachment.findFirst({
    where: { dealId: deal.id, url: formAtt.url },
    select: { id: true, filename: true, mime: true, category: true, url: true },
  });
  if (existing) {
    return NextResponse.json({ attachment: existing, created: false });
  }

  const created = await prisma.dealAttachment.create({
    data: {
      dealId: deal.id,
      filename: formAtt.filename,
      mime: formAtt.mime,
      url: formAtt.url,
      category: formAtt.category,
      source: "form",
      extractedData:
        (formAtt.extractedData as Prisma.InputJsonValue) ?? undefined,
      contentHash: formAtt.contentHash ?? undefined,
    },
    select: { id: true, filename: true, mime: true, category: true, url: true },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "ATTACHMENT_UPLOAD",
    result: "SUCCESS",
    resource: created.id,
    resourceType: "DealAttachment",
    metadata: {
      dealId: deal.id,
      source: "from-form",
      formAttachmentId: formAtt.id,
      filename: created.filename,
      category: created.category,
    },
  });

  return NextResponse.json({ attachment: created, created: true }, { status: 201 });
}
