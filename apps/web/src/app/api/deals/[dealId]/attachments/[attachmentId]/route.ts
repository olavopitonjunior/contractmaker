import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  // Reclassificação ("mover para outra pasta"): grava em
  // extractedData.assignment. kind = vendedor|comprador|imovel|outro (+
  // variantes conjuge/representante que groupKindOf normaliza no front).
  assignment: z
    .object({
      kind: z.string(),
      index: z.number().int().min(0),
    })
    .optional(),
  category: z.string().nullable().optional(),
});

/**
 * PATCH /api/deals/:dealId/attachments/:attachmentId
 *
 * Atualiza a classificação de um DealAttachment — move o documento entre
 * "pastas" (partes/imóvel) gravando extractedData.assignment, e/ou troca a
 * category. Merge não-destrutivo no extractedData existente.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string; attachmentId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.attachmentId },
    include: { deal: { select: { pipeline: { select: { orgId: true } } } } },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
  }
  if (attachment.dealId !== params.dealId) {
    return NextResponse.json(
      { error: "Anexo não pertence a este deal" },
      { status: 400 }
    );
  }
  if (attachment.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data: { extractedData?: object; category?: string | null } = {};
  if (parsed.data.assignment) {
    const current =
      (attachment.extractedData as Record<string, unknown> | null) ?? {};
    data.extractedData = { ...current, assignment: parsed.data.assignment };
  }
  if (parsed.data.category !== undefined) {
    data.category = parsed.data.category;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  await prisma.dealAttachment.update({
    where: { id: attachment.id },
    data,
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "ATTACHMENT_RECLASSIFY",
    result: "SUCCESS",
    resource: attachment.id,
    resourceType: "DealAttachment",
    metadata: {
      dealId: attachment.dealId,
      assignment: parsed.data.assignment ?? null,
      category: parsed.data.category ?? attachment.category,
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/deals/:dealId/attachments/:attachmentId
 *
 * Apaga um documento (DealAttachment) específico do negócio. Best-effort
 * deleta o blob no Vercel Blob/S3. CertidaoJob com FK para o attachment
 * recebe SET NULL via schema.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { dealId: string; attachmentId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.attachmentId },
    include: {
      deal: {
        select: { id: true, pipeline: { select: { orgId: true } } },
      },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
  }
  if (attachment.dealId !== params.dealId) {
    return NextResponse.json(
      { error: "Anexo não pertence a este deal" },
      { status: 400 }
    );
  }
  if (attachment.deal.pipeline.orgId !== org.id) {
    return NextResponse.json(
      { error: "Forbidden", reason: "deal de outra organização" },
      { status: 403 }
    );
  }

  // Best-effort: remove o objeto de storage despachando por backend (Vercel
  // Blob / S3 / filesystem). Antes só limpava Vercel Blob — URLs s3://, file://
  // ficavam órfãs.
  const { deleteFromStorage } = await import("@/lib/storage/s3");
  const blobDeleted = await deleteFromStorage(attachment.url);

  await prisma.dealAttachment.delete({ where: { id: attachment.id } });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "ATTACHMENT_DELETE",
    result: "SUCCESS",
    resource: attachment.id,
    resourceType: "DealAttachment",
    metadata: {
      dealId: attachment.dealId,
      filename: attachment.filename,
      category: attachment.category,
      blobDeleted,
    },
  });

  return NextResponse.json({ deleted: true });
}
