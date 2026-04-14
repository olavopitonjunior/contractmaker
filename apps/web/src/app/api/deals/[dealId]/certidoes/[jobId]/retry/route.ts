import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { runSingleJob } from "@/lib/certidoes/executor";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
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
  if (!job || job.dealId !== params.dealId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.deal.form && job.deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.status !== "failed") {
    return NextResponse.json(
      { error: "Apenas jobs falhos podem ser retentados" },
      { status: 400 }
    );
  }

  await prisma.certidaoJob.update({
    where: { id: params.jobId },
    data: {
      status: "pending",
      errorMessage: null,
      retryCount: { increment: 1 },
      startedAt: null,
      finishedAt: null,
    },
  });

  void runSingleJob(params.jobId, params.dealId).catch((err) => {
    console.error("[certidoes] retry failed", err);
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
