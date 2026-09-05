import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { readAttachmentExtracted } from "@/lib/proposals/attachment-assignment";
import {
  resolvePublicUploadScope,
  publicUploadDenialStatus,
  PUBLIC_UPLOAD_DENIAL_MESSAGE,
} from "@/lib/proposals/public-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/public/proposals/:token/attachments  (PÚBLICO)
 *
 * Lista só o que o PRÓPRIO LEAD enviou (`source: "public"`) — nunca os
 * documentos da imobiliária, o dossiê ou o PDF assinado. Sem URL: o lead não
 * abre arquivo por aqui, só vê o que já subiu e remove pelo id.
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const r = await resolvePublicUploadScope(params.token);
  if (!r.ok) {
    return NextResponse.json(
      { error: PUBLIC_UPLOAD_DENIAL_MESSAGE[r.reason] },
      { status: publicUploadDenialStatus(r.reason) }
    );
  }
  const rows = await prisma.proposalAttachment.findMany({
    where: { proposalId: r.scope.proposalId, source: "public" },
    orderBy: { createdAt: "asc" },
    select: { id: true, filename: true, mime: true, status: true, createdAt: true, extractedData: true },
  });
  return NextResponse.json({
    attachments: rows.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      status: a.status,
      createdAt: a.createdAt,
      assignment: readAttachmentExtracted(a.extractedData).assignment,
    })),
  });
}
