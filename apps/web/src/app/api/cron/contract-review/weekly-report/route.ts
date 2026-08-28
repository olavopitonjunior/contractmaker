import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { alertRecipients } from "@/lib/alerts/platform-alerts";
import { sendEmail } from "@/lib/email/client";
import {
  buildWeeklyReviewMetrics,
  renderWeeklyReviewEmail,
} from "@/lib/contract-review/weekly-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_PATH = "/api/cron/contract-review/weekly-report";
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/cron/contract-review/weekly-report — semanal (segunda de manhã).
 *
 * Observação da feature que nasceu ON para todos: runs, achados por categoria,
 * descartes do guardrail (alucinação), comentários resolvidos × ignorados e
 * custo por org contra o cap diário — num e-mail para os super-admins. E-mail
 * SEMPRE sai, mesmo com zero atividade: semana muda sem run com geração
 * acontecendo é sinal de pipeline quebrado, e silêncio esconderia isso.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!(await isCronAllowedInStaging(CRON_PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: CRON_PATH });
  }

  const until = new Date();
  const since = new Date(until.getTime() - WINDOW_MS);

  const [runs, comments, usage] = await Promise.all([
    prisma.contractReviewRun.findMany({
      where: { createdAt: { gte: since } },
      select: { status: true, orgId: true, report: true },
    }),
    prisma.contractComment.findMany({
      where: { authorName: "Revisão Pós-Geração", createdAt: { gte: since } },
      select: { severity: true, resolved: true },
    }),
    prisma.aIUsage.groupBy({
      by: ["orgId"],
      where: {
        operation: { in: ["contract_review", "proposal_review"] },
        createdAt: { gte: since },
      },
      _sum: { estimatedCostUsd: true },
      _count: { _all: true },
    }),
  ]);

  const costs = usage
    .filter((u) => u.orgId)
    .map((u) => ({
      orgId: u.orgId as string,
      costUsd: Number(u._sum.estimatedCostUsd ?? 0) || 0,
      calls: u._count._all,
    }));
  const orgs = await prisma.organization.findMany({
    where: { id: { in: costs.map((c) => c.orgId) } },
    select: { id: true, name: true },
  });
  const orgNames = new Map(orgs.map((o) => [o.id, o.name]));

  const metrics = buildWeeklyReviewMetrics({ since, until, runs, comments, costs, orgNames });
  const email = renderWeeklyReviewEmail(metrics);

  const to = await alertRecipients();
  if (to.length === 0) {
    return NextResponse.json({ sent: false, reason: "no-recipients", metrics });
  }
  const result = await sendEmail({ to, subject: email.subject, text: email.text });
  return NextResponse.json({ sent: result.ok, to: to.length, metrics });
}
