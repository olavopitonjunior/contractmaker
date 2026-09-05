import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { archiveAttachment } from "@/lib/attachments/archive";
import { DELETABLE } from "@/lib/certidoes/bulk-delete";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";

export const runtime = "nodejs";

/**
 * DELETE /api/proposals/:id/certidoes/:jobId[?withAttachment=true]
 *
 * Apaga um job terminal da PROPOSTA. Com `withAttachment`, arquiva também o
 * PDF (`ProposalAttachment` ligado por `certidaoJobId`) — linha vai para
 * `DeletedAttachment`, blob fica (mesma política do negócio).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; jobId: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: true });
  if ("fail" in r) return r.fail;
  const { scope } = r;

  const withAttachment = new URL(req.url).searchParams.get("withAttachment") === "true";
  const job = await prisma.certidaoJob.findUnique({ where: { id: params.jobId } });
  if (!job || job.proposalId !== scope.proposal.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!(DELETABLE as readonly string[]).includes(job.status)) {
    return NextResponse.json(
      { error: `Nao e possivel deletar jobs em andamento (${job.status}). Recupere travadas primeiro.` },
      { status: 400 }
    );
  }

  let archivedId: string | null = null;
  if (withAttachment) {
    const pdf = await prisma.proposalAttachment.findFirst({ where: { certidaoJobId: job.id } });
    if (pdf) {
      archivedId = await prisma.$transaction((tx) =>
        archiveAttachment(tx, {
          row: pdf,
          origin: "proposal",
          via: "certidao",
          orgId: scope.orgId,
          userId: scope.userId,
          ipAddress: req.headers.get("x-forwarded-for") ?? null,
        })
      );
    }
  }
  await prisma.certidaoJob.delete({ where: { id: job.id } });

  await audit(extractAuditContextFromRequest(req, scope.orgId, scope.userId), {
    action: "CERTIDAO_JOB_DELETE",
    result: "SUCCESS",
    resource: job.id,
    resourceType: "CertidaoJob",
    metadata: { proposalId: scope.proposal.id, endpoint: job.endpoint, status: job.status, attachmentDeleted: !!archivedId, archivedId },
  }).catch(() => {});

  return NextResponse.json({ ok: true, attachmentDeleted: !!archivedId, archivedId });
}
