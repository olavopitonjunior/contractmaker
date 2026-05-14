import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

export const runtime = "nodejs";

/**
 * DELETE /api/contracts/[id]/chat-attachments/[attachmentId]
 * Hard delete do anexo. Mantemos o blob na Vercel — TTL gerencial cuida
 * dele depois. O importante e remover do contexto do agente.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; attachmentId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const attachment = await prisma.chatAttachment.findUnique({
    where: { id: params.attachmentId },
    include: {
      session: {
        select: {
          contractId: true,
          contract: { select: { userId: true } },
        },
      },
    },
  });
  if (!attachment || attachment.session.contractId !== params.id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  if (
    auth.ident.via === "bearer" &&
    attachment.session.contract.userId !== auth.ident.userId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.chatAttachment.delete({ where: { id: params.attachmentId } });
  return NextResponse.json({ ok: true });
}
