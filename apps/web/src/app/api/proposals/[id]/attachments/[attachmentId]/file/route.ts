import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

export const runtime = "nodejs";

/**
 * GET /api/proposals/:id/attachments/:attachmentId/file[?download=1]
 *
 * Proxy do binário de um anexo da proposta, escopado (mesmo papel do
 * `/api/deals/[dealId]/attachments/[attachmentId]/file`). Existe para a aba
 * de certidões e o relatório apontarem para uma URL estável e autenticada em
 * vez da URL pública do blob.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;

  const attachment = await prisma.proposalAttachment.findUnique({ where: { id: params.attachmentId } });
  if (!attachment || attachment.proposalId !== r.proposal.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const buffer = await downloadBufferFromUrl(attachment.url);
    const forceDownload = new URL(req.url).searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mime,
        "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${attachment.filename}"`,
      },
    });
  } catch (err) {
    console.error("[proposal attachments] download failed", err);
    const { storageDownloadErrorResponse } = await import("@/lib/storage/download-error");
    return storageDownloadErrorResponse(err);
  }
}
