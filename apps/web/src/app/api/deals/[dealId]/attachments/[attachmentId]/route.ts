import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

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

  // Best-effort: remove o blob no Vercel Blob (URLs com domínio public.blob.vercel-storage.com)
  let blobDeleted = false;
  if (attachment.url && attachment.url.includes(".public.blob.vercel-storage.com")) {
    try {
      const { del } = await import("@vercel/blob");
      await del(attachment.url);
      blobDeleted = true;
    } catch (err) {
      console.warn(
        "[attachment DELETE] falha ao remover blob:",
        err instanceof Error ? err.message : err
      );
    }
  }

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
