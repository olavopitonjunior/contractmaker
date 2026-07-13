import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

export const runtime = "nodejs";

/**
 * GET /api/locacao/clients/[id]/attachments/[attachmentId]/file
 * Serve o documento do cliente (inline por padrão, ?download=1 força download).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; attachmentId: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_VIEW);
  if (isRouteError(ctx)) return ctx;

  const attachment = await prisma.leaseClientAttachment.findUnique({
    where: { id: params.attachmentId },
    include: { leaseClient: { select: { orgId: true, id: true } } },
  });
  if (!attachment || attachment.leaseClientId !== params.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  if (attachment.leaseClient.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const buffer = await downloadBufferFromUrl(attachment.url);
    const forceDownload = new URL(req.url).searchParams.get("download") === "1";
    const disposition = forceDownload ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mime,
        "Content-Disposition": `${disposition}; filename="${attachment.filename}"`,
      },
    });
  } catch (err) {
    console.error("[client-attachments] download failed", err);
    return NextResponse.json({ error: "Falha ao servir arquivo" }, { status: 500 });
  }
}
