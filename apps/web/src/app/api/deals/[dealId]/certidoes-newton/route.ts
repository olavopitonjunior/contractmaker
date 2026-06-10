import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { requireApproval } from "@/lib/api/intents";
import { planCertidoesForDeal, diligentedPersonToInput } from "@/lib/certidoes/planner";
import { getMonthlySpend } from "@/lib/certidoes/executor";
import { checkGovBrAuth } from "@/lib/certidoes/govbr-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  batchId: z.string().uuid(),
});

/**
 * POST /api/deals/:dealId/certidoes-newton
 *
 * Newton-friendly Bearer twin de `/api/deals/:dealId/certidoes`. Sempre HITL
 * (cria ActionIntent CERTIDAO_REQUEST) porque consome budget Infosimples.
 *
 * Body: `{ batchId }` — Newton gera UUID v4 upfront para idempotência.
 *
 * Pre-flight (antes de criar a intent): roda o planner em modo auto pra
 * mostrar custo estimado no preview da intent. Re-roda no executor quando
 * humano aprovar (dados podem ter mudado), com check de budget atual.
 *
 * Não suporta `jobs` selecionados (auto plan apenas) na v1 — adicionar
 * conforme demanda.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { batchId } = parsed.data;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { orgId: true, dataJson: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Idempotência por batch: rejeita se já existe batch ativo recente.
  const activeBatch = await prisma.certidaoJob.findFirst({
    where: {
      dealId: params.dealId,
      status: { in: ["pending", "fetching"] },
      createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
    select: { batchId: true },
  });
  if (activeBatch) {
    return NextResponse.json(
      {
        error: "Já existe extração em andamento para este deal.",
        activeBatchId: activeBatch.batchId,
      },
      { status: 409 }
    );
  }

  // Pre-flight planner (estimativa pra preview). Sem dispatch.
  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ??
    (deal.dataJson as Record<string, unknown> | null);
  const diligenciadosRaw = await prisma.diligentedPerson.findMany({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "asc" },
  });
  const diligenciados = diligenciadosRaw.map(diligentedPersonToInput);
  const govbr = await checkGovBrAuth();
  const plan = planCertidoesForDeal(dealData as never, undefined, diligenciados, {
    expandAll: false,
    govBrActive: govbr.active,
  });
  const totalCostCents = plan.jobs.reduce((acc, j) => acc + j.costCents, 0);

  if (plan.jobs.length === 0 && plan.skipped.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma certidão disponível para este deal", plan },
      { status: 400 }
    );
  }

  const idempotencyKey =
    req.headers.get("x-idempotency-key") ?? batchId;

  const result = await requireApproval({
    ctx: apiAuth,
    action: "CERTIDAO_REQUEST",
    payload: { dealId: params.dealId, batchId },
    preview: {
      summary: `Solicitar ${plan.jobs.length} certidão(ões) para deal ${params.dealId} (custo estimado R$ ${(totalCostCents / 100).toFixed(2)})`,
      details: {
        dealId: params.dealId,
        jobCount: plan.jobs.length,
        skippedCount: plan.skipped.length,
        totalCostCents,
        endpoints: plan.jobs.map((j) => j.label),
      },
    },
    req,
    idempotencyKey,
    run: async () => {
      // via=session: executa direto. Newton em geral é via=bearer, então este
      // branch só roda se UI usar este endpoint. Reusa executor pra DRY.
      const { runCertidoesBatchInline } = await import(
        "@/lib/certidoes/newton-runner"
      );
      return runCertidoesBatchInline({
        dealId: params.dealId,
        orgId: apiAuth.org.id,
        userId: apiAuth.actor.effectiveUserId,
        batchId,
      });
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
