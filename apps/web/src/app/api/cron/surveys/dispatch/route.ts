import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { dispatchSurveysForDeal } from "@/lib/surveys/dispatch";
import { sendSurveyInvite } from "@/lib/surveys/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOOKBACK_MS = 48 * 60 * 60 * 1000;

/**
 * Cron de RECONCILIAÇÃO do disparo de pesquisas (a cada 15 min).
 *
 * O caminho primário é o hook `queueSurveyDispatch` nos call-sites de mudança
 * de stage; este cron cobre hook perdido (crash/deploy/call-site futuro
 * esquecido) varrendo deals que entraram num stage com automação nas últimas
 * 48h. O dedupe atômico (`SurveyInvite.dedupeKey @unique`) torna o
 * reprocessamento inofensivo. Também expira invites com token vencido e
 * re-tenta envios `failed`.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/surveys/dispatch"))) {
    return NextResponse.json({ skipped: "staging" });
  }

  // Pré-query: só stages que alguma automação habilitada observa.
  const active = await prisma.surveyAutomation.findMany({
    where: { enabled: true },
    select: { orgId: true, dealKind: true, triggerStageName: true },
    distinct: ["orgId", "dealKind", "triggerStageName"],
  });
  if (active.length === 0) {
    return NextResponse.json({ scanned: 0, dispatched: 0, expired: 0 });
  }

  const stageNames = Array.from(new Set(active.map((a) => a.triggerStageName)));
  const orgIds = Array.from(new Set(active.map((a) => a.orgId)));

  const deals = await prisma.deal.findMany({
    where: {
      stageEnteredAt: { gte: new Date(Date.now() - LOOKBACK_MS) },
      stage: { name: { in: stageNames } },
      pipeline: { orgId: { in: orgIds } },
    },
    select: { id: true },
    take: 500,
  });

  let created = 0;
  for (const deal of deals) {
    try {
      const result = await dispatchSurveysForDeal(deal.id);
      created += result.created;
    } catch (e) {
      console.error("[cron surveys/dispatch] deal falhou", deal.id, e);
    }
  }

  // Re-tenta envios de e-mail que falharam (falha transitória de SMTP no
  // disparo inicial). O sendSurveyInvite re-marca "failed" se falhar de novo,
  // então cada sweep faz no máximo 1 tentativa por invite.
  const failed = await prisma.surveyInvite.findMany({
    where: {
      status: "failed",
      channel: "email",
      tokenExp: { gt: new Date() },
      recipientEmail: { not: null },
    },
    select: {
      id: true,
      orgId: true,
      token: true,
      channel: true,
      recipientName: true,
      recipientEmail: true,
      recipientPhone: true,
      remindersSent: true,
      template: { select: { name: true } },
    },
    take: 100,
  });
  let retried = 0;
  for (const invite of failed) {
    const sent = await sendSurveyInvite({
      invite,
      templateName: invite.template.name,
      orgId: invite.orgId,
    });
    if (sent.ok) retried++;
  }

  // Expira invites vencidos ainda em aberto (pending/sent/failed).
  const expired = await prisma.surveyInvite.updateMany({
    where: {
      status: { in: ["pending", "sent", "failed"] },
      tokenExp: { lt: new Date() },
    },
    data: { status: "expired" },
  });

  return NextResponse.json({
    scanned: deals.length,
    dispatched: created,
    retried,
    expired: expired.count,
  });
}
