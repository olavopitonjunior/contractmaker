import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * DELETE /api/deals/:dealId/certidoes/:jobId
 *
 * Deletes a single CertidaoJob. Only jobs in terminal states
 * (failed, success, skipped) can be deleted — in-progress jobs must be
 * swept first. The associated DealAttachment (if any) is NOT deleted —
 * attachments persist even after the job row is gone.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { dealId: string; jobId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const job = await prisma.certidaoJob.findUnique({
    where: { id: params.jobId },
    include: { deal: { include: { form: { select: { orgId: true } } } } },
  });
  if (!job || job.dealId !== params.dealId || !job.deal) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.deal.form && job.deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const terminal = ["failed", "success", "skipped"];
  if (!terminal.includes(job.status)) {
    return NextResponse.json(
      {
        error: `Nao e possivel deletar jobs em andamento (${job.status}). Recupere travadas primeiro.`,
      },
      { status: 400 }
    );
  }

  await prisma.certidaoJob.delete({ where: { id: params.jobId } });

  return NextResponse.json({ ok: true });
}
