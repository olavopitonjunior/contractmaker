import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

export const runtime = "nodejs";

/**
 * GET /s/certidoes/:token/file/:attachmentId
 *
 * Public endpoint — serves a certidão PDF by share token. No auth required.
 * Security: validates that (1) the token is not revoked and not expired,
 * (2) the attachment belongs to the same deal as the token.
 *
 * Rate limiting is left to the infrastructure (Vercel) for now. If abuse is
 * detected, add a simple in-memory counter keyed by token.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string; attachmentId: string } }
) {
  const link = await prisma.certidoesShareLink.findUnique({
    where: { token: params.token },
  });
  if (!link || link.revokedAt || link.expiresAt < new Date()) {
    return NextResponse.json({ error: "Link invalido ou expirado" }, { status: 404 });
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.attachmentId },
    select: { id: true, dealId: true, filename: true, mime: true, url: true },
  });
  if (!attachment || attachment.dealId !== link.dealId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = await downloadBufferFromUrl(attachment.url);
    const { searchParams } = new URL(req.url);
    const forceDownload = searchParams.get("download") === "1";
    const disposition = forceDownload ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mime,
        "Content-Disposition": `${disposition}; filename="${attachment.filename}"`,
      },
    });
  } catch (err) {
    const { storageDownloadErrorResponse } = await import(
      "@/lib/storage/download-error"
    );
    return storageDownloadErrorResponse(err, {
      notFoundMessage:
        "Arquivo indisponível no armazenamento (pode ter sido removido).",
    });
  }
}
