/**
 * GET /api/deals/[dealId]/certidoes/analysis
 *
 * F4.7 — Endpoint que expõe os findings do `crossCheckCertidoes` pro painel
 * de Certidões da UI. Não chama LLM — só roda a pure function contra os
 * jobs já persistidos no Neon. Custo: 1 query + 1 sum de findings.
 *
 * Auth: NextAuth session + cross-org guard via Deal.pipeline.orgId.
 *
 * Response:
 *   {
 *     dealId,
 *     contractId | null,       // rascunho mais recente do deal
 *     jobs: { total, success, failed, pending },
 *     findings: CrossCheckFinding[],  // com suggested_aditamento, manual_action
 *     summary: { total, bySeverity, hasBlockingIssues }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { prisma } from "@/lib/db/prisma";
import { crossCheckCertidoes } from "@/lib/ai/crosscheck/certidoes";
import { getDealSigningState } from "@/lib/contracts/signing-state";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      pipeline: { select: { orgId: true } },
      contracts: {
        where: { status: "rascunho" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, dataJson: true },
      },
    },
  });

  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  // Cross-org + escopo do gerente. Esta rota só exigia sessão — o guard
  // acrescenta o escopo de org E o do gerente de uma vez.
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
  });
  if (denied) return denied;

  // Sem contrato rascunho, ainda podemos rodar análise usando os dados do
  // formulário/lead se quisermos no futuro. Por enquanto, devolve findings
  // só se há contrato (cross_check exige dataJson).
  const contract = deal.contracts[0] ?? null;
  if (!contract) {
    return NextResponse.json({
      dealId: deal.id,
      contractId: null,
      jobs: { total: 0, success: 0, failed: 0, pending: 0 },
      findings: [],
      summary: { total: 0, bySeverity: { error: 0, warning: 0, info: 0 }, hasBlockingIssues: false },
      message:
        "Nenhum contrato rascunho — gere o contrato antes pra análise cruzada.",
    });
  }

  const jobs = await prisma.certidaoJob.findMany({
    where: { dealId: params.dealId },
    select: {
      id: true,
      endpoint: true,
      label: true,
      targetKind: true,
      targetIndex: true,
      status: true,
      resultCode: true,
      resultData: true,
      errorMessage: true,
      finishedAt: true,
      attachmentId: true,
    },
    orderBy: { finishedAt: "desc" },
  });

  const counts = {
    total: jobs.length,
    success: jobs.filter((j) => j.status === "success").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    pending: jobs.filter(
      (j) => j.status === "pending" || j.status === "fetching" || j.status === "awaiting_portal"
    ).length,
  };

  const result = crossCheckCertidoes({
    contractDataJson: contract.dataJson as Record<string, unknown>,
    jobs,
  });

  // F4 iteração 2026-05-17 — UI decide entre "Aplicar no contrato" e
  // "Criar aditamento" baseado em signingState. Backend é fonte de verdade.
  const signingState = await getDealSigningState(deal.id);

  return NextResponse.json({
    dealId: deal.id,
    contractId: contract.id,
    jobs: counts,
    findings: result.findings,
    summary: result.summary,
    signingState,
  });
}
