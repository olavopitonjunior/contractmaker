import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { runSingleJob } from "@/lib/certidoes/executor";
import { z } from "zod";

export const runtime = "nodejs";
// I.7 (2026-05-11) — bulk-retry dispara N runSingleJob em paralelo; com
// TJSP+auth GOV.BR cada um pode levar 3-10min. 300s era insuficiente.
export const maxDuration = 660;

const bulkRetrySchema = z.object({
  // Filtra jobs por: (a) failureCategory específica (provider_timeout,
  // portal_unavailable, rate_limited, integration_error, missing_input...)
  // ou (b) status terminal (failed | skipped).
  // Pelo menos um dos dois é obrigatório.
  category: z.string().optional(),
  status: z.enum(["failed", "skipped"]).optional(),
  // Dry-run: retorna quais jobs SERIAM re-executados sem executar
  dryRun: z.boolean().optional(),
});

/**
 * POST /api/deals/:dealId/certidoes/bulk-retry
 *
 * Phase F.II-β — dispara retry em massa em todos os jobs do deal que batam
 * com o filtro. Útil quando provedor volta ao ar (retry todos os
 * provider_timeout) ou depois de corrigir integração (retry todos os
 * integration_error).
 *
 * Retorna 202 com lista de job IDs que foram re-dispatched.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bulkRetrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { category, status, dryRun } = parsed.data;

  if (!category && !status) {
    return NextResponse.json(
      { error: "Informe pelo menos um de: category ou status" },
      { status: 400 }
    );
  }

  // Verify deal belongs to this org
  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      form: { select: { orgId: true } },
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch candidate jobs
  const candidates = await prisma.certidaoJob.findMany({
    where: {
      dealId: params.dealId,
      ...(status ? { status } : {}),
    },
    select: {
      id: true,
      endpoint: true,
      label: true,
      status: true,
      resultData: true,
      retryCount: true,
    },
  });

  // Filter by category (stored inside resultData.failureCategory)
  const matched = category
    ? candidates.filter((j) => {
        const r = j.resultData as { failureCategory?: string } | null;
        return r?.failureCategory === category;
      })
    : candidates;

  // Respect per-job MAX_RETRIES limit (mesmo do /retry endpoint individual)
  const MAX_RETRIES = 3;
  const retriable = matched.filter((j) => j.retryCount < MAX_RETRIES);
  const skippedByRetry = matched.filter((j) => j.retryCount >= MAX_RETRIES);

  if (dryRun) {
    return NextResponse.json({
      mode: "dry-run",
      candidates: candidates.length,
      matched: matched.length,
      retriable: retriable.length,
      skippedByRetry: skippedByRetry.length,
      jobs: retriable.map((j) => ({
        id: j.id,
        endpoint: j.endpoint,
        label: j.label,
        retryCount: j.retryCount,
      })),
    });
  }

  if (retriable.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        message: "Nenhum job elegível para retry (todos atingiram MAX_RETRIES ou não batem no filtro)",
        skippedByRetry: skippedByRetry.length,
      },
      { status: 200 }
    );
  }

  // Reset state + enqueue. Mesma transação que o retry individual faz em
  // retry/route.ts, mas em bulk.
  const now = new Date();
  await prisma.certidaoJob.updateMany({
    where: { id: { in: retriable.map((j) => j.id) } },
    data: {
      status: "pending",
      resultCode: null,
      resultMessage: null,
      errorMessage: null,
      latencyMs: null,
      startedAt: null,
      finishedAt: null,
      retryCount: { increment: 1 },
    },
  });

  // waitUntil mantém o lambda vivo até o batch terminar; sem ele as
  // promises orfanam após o NextResponse (mesmo bug do POST principal).
  // Cada job roda independente — falhas não abortam os outros.
  waitUntil(
    Promise.allSettled(
      retriable.map((j) => runSingleJob(j.id, params.dealId))
    ).catch((err) => {
      console.error("[bulk-retry] batch failed:", err);
    })
  );

  return NextResponse.json(
    {
      ok: true,
      mode: "executed",
      dispatched: retriable.length,
      skippedByRetry: skippedByRetry.length,
      retriedAt: now,
      jobIds: retriable.map((j) => j.id),
    },
    { status: 202 }
  );
}
