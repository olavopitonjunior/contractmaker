import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { bulkDeleteSchema, buildBulkDeleteWhere } from "@/lib/certidoes/bulk-delete";
import { archiveAttachment } from "@/lib/attachments/archive";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";

export const runtime = "nodejs";

/** POST /api/proposals/:id/certidoes/bulk-delete — espelho do Deal (escopos de `bulk-delete.ts`). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: true });
  if ("fail" in r) return r.fail;
  const { scope } = r;

  const parsed = bulkDeleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const built = buildBulkDeleteWhere(parsed.data);
  if ("error" in built) return NextResponse.json({ error: built.error }, { status: 400 });

  const where: Prisma.CertidaoJobWhereInput = { proposalId: scope.proposal.id, ...built.where };
  const candidates = await prisma.certidaoJob.findMany({ where, select: { id: true } });
  if (parsed.data.dryRun) {
    return NextResponse.json({ mode: "dry-run", count: candidates.length, withAttachments: !!parsed.data.withAttachments });
  }
  if (candidates.length === 0) return NextResponse.json({ deleted: 0, attachmentsDeleted: 0 });

  const ids = candidates.map((c) => c.id);
  const archivedIds: string[] = [];
  if (parsed.data.withAttachments) {
    const pdfs = await prisma.proposalAttachment.findMany({ where: { certidaoJobId: { in: ids } } });
    const ip = req.headers.get("x-forwarded-for") ?? null;
    for (const pdf of pdfs) {
      const archivedId = await prisma.$transaction((tx) =>
        archiveAttachment(tx, { row: pdf, origin: "proposal", via: "certidao", orgId: scope.orgId, userId: scope.userId, ipAddress: ip })
      );
      archivedIds.push(archivedId);
    }
  }
  const deleted = await prisma.certidaoJob.deleteMany({ where: { id: { in: ids } } });

  await audit(extractAuditContextFromRequest(req, scope.orgId, scope.userId), {
    action: "CERTIDAO_BULK_DELETE",
    result: "SUCCESS",
    resource: scope.proposal.id,
    resourceType: "Proposal",
    metadata: {
      scope: parsed.data.scope,
      status: parsed.data.status ?? null,
      batchId: parsed.data.batchId ?? null,
      deleted: deleted.count,
      attachmentsDeleted: archivedIds.length,
      archivedIds,
    },
  }).catch(() => {});

  return NextResponse.json({ deleted: deleted.count, attachmentsDeleted: archivedIds.length, archivedIds });
}
