import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal } from "@/lib/certidoes/planner";
import { runBatch, getMonthlySpend } from "@/lib/certidoes/executor";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { sanitizePayload } from "@/lib/certidoes/infosimples";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 300;

async function authorizeDeal(dealId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized", status: 401 as const };
  const org = await getUserOrg(session.user.id);
  if (!org) return { error: "No organization", status: 400 as const };
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      form: { select: { orgId: true, dataJson: true } },
    },
  });
  if (!deal) return { error: "Deal not found", status: 404 as const };
  if (deal.form && deal.form.orgId !== org.id) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { deal, org, userId: session.user.id };
}

/**
 * GET /api/deals/:dealId/certidoes?batchId=xxx
 * Lists jobs (optionally scoped to a batch).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await authorizeDeal(params.dealId);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  const jobs = await prisma.certidaoJob.findMany({
    where: {
      dealId: params.dealId,
      ...(batchId ? { batchId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      attachment: { select: { id: true, filename: true, mime: true } },
    },
  });

  // derive latest batch meta
  const latestBatchId = jobs[0]?.batchId;
  return NextResponse.json({
    jobs,
    latestBatchId,
  });
}

const extractSchema = z.object({
  batchId: z.string().min(8),
  jobEndpoints: z.array(z.string()).optional(),
});

/**
 * POST /api/deals/:dealId/certidoes
 * Body: { batchId, jobEndpoints? } — creates jobs from the planner and fires the executor.
 * The client generates batchId upfront and starts polling GET immediately.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await authorizeDeal(params.dealId);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { deal } = authResult;

  const body = await req.json().catch(() => ({}));
  const parsed = extractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { batchId } = parsed.data;

  // Budget guard
  const spend = await getMonthlySpend();
  if (spend.exceeded) {
    return NextResponse.json(
      {
        error: "Budget mensal de certidoes atingido",
        spend,
      },
      { status: 402 }
    );
  }

  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ||
    (deal.dataJson as Record<string, unknown> | null);
  const plan = planCertidoesForDeal(dealData as any);

  if (plan.jobs.length === 0) {
    return NextResponse.json(
      {
        error: "Nenhuma certidao disponivel para extrair",
        plan,
      },
      { status: 400 }
    );
  }

  // Check if budget would be exceeded
  if (spend.spentCents + plan.totalCostCents > spend.budgetCents) {
    return NextResponse.json(
      {
        error: "Este lote estouraria o budget mensal de certidoes",
        spend,
        plan,
      },
      { status: 402 }
    );
  }

  // Create all job rows atomically
  await prisma.$transaction(
    plan.jobs.map((p) => {
      const info = endpointInfo(p.endpoint);
      return prisma.certidaoJob.create({
        data: {
          dealId: params.dealId,
          batchId,
          endpoint: p.endpoint,
          label: p.label,
          targetKind: p.targetKind,
          targetIndex: p.targetIndex,
          requestPayload: sanitizePayload(p.requestPayload) as object,
          status: info.initialStatus ?? "pending",
          costCents: null,
        },
      });
    })
  );

  // Fire-and-forget: execute batch while the response is returned to the client.
  // In Next 14 on Vercel, the function lives until maxDuration (300s) as long
  // as the promise is running — even after the response is sent, because we
  // are NOT awaiting it. We rely on Node's event loop keeping the process
  // alive for the duration of the promise. If the runtime terminates early,
  // jobs stuck in 'pending' will be picked up by the portal poller cron.
  void runBatch(batchId, params.dealId).catch((err) => {
    console.error("[certidoes] runBatch failed", err);
  });

  return NextResponse.json(
    {
      batchId,
      jobCount: plan.jobs.length,
      skipped: plan.skipped,
      totalCostCents: plan.totalCostCents,
    },
    { status: 202 }
  );
}
