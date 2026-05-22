import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * GET /api/certidoes/:jobId/attempts
 *
 * Histórico de tentativas de um CertidaoJob (relatório com JSON), lido do
 * CertidaoJobAuditLog (toda transição grava resultCode/endpoint/latência). Usado
 * pelo painel de monitoramento. Escopo: org do usuário (via job.orgId ou
 * deal.form.orgId).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
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
    select: {
      id: true,
      orgId: true,
      dealId: true,
      endpoint: true,
      label: true,
      status: true,
      resultCode: true,
      resultMessage: true,
      resultData: true,
      errorMessage: true,
      retryCount: true,
      maxRetries: true,
      costCents: true,
      requestPayload: true,
      deal: { select: { form: { select: { orgId: true } } } },
    },
  });
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }
  const jobOrgId = job.orgId ?? job.deal?.form?.orgId ?? null;
  if (jobOrgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const attempts = await prisma.certidaoJobAuditLog.findMany({
    where: { jobId: job.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      metadata: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    job: {
      id: job.id,
      endpoint: job.endpoint,
      label: job.label,
      status: job.status,
      resultCode: job.resultCode,
      resultMessage: job.resultMessage,
      resultData: job.resultData,
      errorMessage: job.errorMessage,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      costCents: job.costCents,
      // requestPayload já vem sanitizado (sem token/credenciais) por sanitizePayload.
      requestPayload: job.requestPayload,
    },
    attempts,
  });
}
