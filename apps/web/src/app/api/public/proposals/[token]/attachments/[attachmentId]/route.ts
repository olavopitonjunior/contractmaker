import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { archiveAttachment } from "@/lib/attachments/archive";
import { audit } from "@/lib/security/audit";
import { publicRequestIpHash } from "@/lib/proposals/public-request";
import {
  resolvePublicUploadScope,
  publicUploadDenialStatus,
  PUBLIC_UPLOAD_DENIAL_MESSAGE,
} from "@/lib/proposals/public-upload";

export const runtime = "nodejs";

/**
 * DELETE /api/public/proposals/:token/attachments/:attachmentId  (PÚBLICO)
 *
 * O lead remove um documento que ELE MESMO enviou (`source: "public"`) —
 * subiu o arquivo errado, quer trocar. Nunca toca em documento da imobiliária,
 * dossiê ou PDF assinado (404 genérico, sem revelar que existem).
 *
 * Mesma política de remoção do anexo interno: a linha vai para
 * `DeletedAttachment` na mesma transação e o blob é preservado (o convert
 * reusa a URL; ver `[attachmentId]/route.ts` da proposta).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { token: string; attachmentId: string } }
) {
  const r = await resolvePublicUploadScope(params.token);
  if (!r.ok) {
    return NextResponse.json(
      { error: PUBLIC_UPLOAD_DENIAL_MESSAGE[r.reason] },
      { status: publicUploadDenialStatus(r.reason) }
    );
  }
  const { scope } = r;
  // Rota pública: rastro por ipHash, nunca IP cru (LGPD).
  const ipHash = publicRequestIpHash(req);

  const attachment = await prisma.proposalAttachment.findUnique({ where: { id: params.attachmentId } });
  if (!attachment || attachment.proposalId !== scope.proposalId || attachment.source !== "public") {
    return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  }

  const archivedId = await prisma.$transaction((tx) =>
    archiveAttachment(tx, {
      row: attachment,
      origin: "proposal",
      via: "public_proposal",
      orgId: scope.orgId,
      userId: null,
      ipAddress: ipHash,
    })
  );

  await prisma.proposalEvent
    .create({
      data: {
        proposalId: scope.proposalId,
        eventName: "document_removed",
        source: "public",
        ipHash,
        payload: { attachmentId: attachment.id, archivedId },
      },
    })
    .catch(() => {});

  await audit(
    {
      orgId: scope.orgId,
      userId: null,
      ipAddress: ipHash,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    {
      action: "ATTACHMENT_DELETE",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "ProposalAttachment",
      metadata: {
        proposalId: scope.proposalId,
        filename: attachment.filename,
        source: attachment.source,
        archivedId,
        recoverable: true,
        via: "public_lead",
      },
    }
  ).catch(() => {});

  return NextResponse.json({ deleted: true });
}
