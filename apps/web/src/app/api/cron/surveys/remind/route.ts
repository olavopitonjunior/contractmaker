import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { sendSurveyInvite } from "@/lib/surveys/channels";
import { isAnySurveyFeatureEnabled } from "@/lib/surveys/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OFFSETS = [2, 5];

/**
 * Régua de lembretes (diário 13 UTC): invites `sent` por e-mail que ainda não
 * foram respondidos recebem lembrete em D+offset (offsets da automação;
 * default D+2/D+5). Para ao responder/optout/expirar por definição de status.
 * Envio manual (link copiado) não recebe lembrete automático.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/surveys/remind"))) {
    return NextResponse.json({ skipped: "staging" });
  }

  const candidates = await prisma.surveyInvite.findMany({
    where: {
      status: "sent",
      channel: "email",
      sentAt: { not: null },
      tokenExp: { gt: new Date() },
    },
    select: {
      id: true,
      orgId: true,
      token: true,
      channel: true,
      recipientName: true,
      recipientEmail: true,
      recipientPhone: true,
      sentAt: true,
      remindersSent: true,
      automationId: true,
      template: { select: { name: true } },
    },
    take: 500,
  });
  if (candidates.length === 0) {
    return NextResponse.json({ scanned: 0, reminded: 0 });
  }

  // Offsets por automação (envio manual por e-mail usa o default).
  const automationIds = Array.from(
    new Set(candidates.map((c) => c.automationId).filter((id): id is string => !!id))
  );
  const automations = automationIds.length
    ? await prisma.surveyAutomation.findMany({
        where: { id: { in: automationIds } },
        select: { id: true, reminderOffsetsDays: true },
      })
    : [];
  const offsetsById = new Map(automations.map((a) => [a.id, a.reminderOffsetsDays]));

  // Orgs que desligaram a feature não recebem mais reminders.
  const orgIds = Array.from(new Set(candidates.map((c) => c.orgId)));
  const enabledByOrg = new Map<string, boolean>();
  for (const orgId of orgIds) {
    enabledByOrg.set(orgId, await isAnySurveyFeatureEnabled(orgId).catch(() => false));
  }

  let reminded = 0;
  const now = Date.now();

  for (const invite of candidates) {
    if (!enabledByOrg.get(invite.orgId)) continue;
    const offsets = invite.automationId
      ? offsetsById.get(invite.automationId) ?? DEFAULT_OFFSETS
      : DEFAULT_OFFSETS;
    if (invite.remindersSent >= offsets.length) continue;

    const dueAt =
      (invite.sentAt as Date).getTime() + offsets[invite.remindersSent] * DAY_MS;
    if (dueAt > now) continue;

    const sent = await sendSurveyInvite({
      invite,
      templateName: invite.template.name,
      orgId: invite.orgId,
      isReminder: true,
    });
    if (sent.ok) reminded++;
  }

  return NextResponse.json({ scanned: candidates.length, reminded });
}
