import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { notifyDealEvent } from "@/lib/notifications/deal-events";
import { formPublicPath } from "@/lib/forms/form-url";
import { resolveEffectiveNotificationConfig } from "@/lib/notifications/deal-events-config";

export const runtime = "nodejs";
export const maxDuration = 60;

const CRON_PATH = "/api/cron/forms/fill-reminder";

/**
 * Lembrete de preenchimento do formulário (vendas E locação) — roda 1×/dia.
 * Forms abertos (completedAt null) com idade em dias ∈ formReminder.days da
 * org geram `form_reminder` pros corretores do negócio (v1: o lembrete cobra
 * o corretor, que reencaminha o link público à parte; lembrete direto à parte
 * fica pra v2 junto com o público "party").
 *
 * Idempotência em 3 camadas: cron 1×/dia + dedupeKey `d${N}` no
 * DealNotificationLog (unique) + batchId do sino. Re-execução no mesmo dia é
 * no-op.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!(await isCronAllowedInStaging(CRON_PATH))) {
    return NextResponse.json({ ok: true, skipped: "staging" });
  }

  const now = Date.now();
  const maxAgeDays = 60;
  const forms = await prisma.salesForm.findMany({
    where: {
      completedAt: null,
      lockedAt: null,
      createdAt: { gte: new Date(now - maxAgeDays * 86_400_000) },
      deal: { isNot: null },
    },
    select: {
      id: true,
      orgId: true,
      token: true,
      title: true,
      createdAt: true,
      deal: {
        select: { id: true, lostAt: true, archivedAt: true },
      },
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  // Config do lembrete é org-level — cacheia por org dentro do run.
  const orgConfig = new Map<
    string,
    Awaited<ReturnType<typeof resolveEffectiveNotificationConfig>>
  >();

  let dispatched = 0;
  let skipped = 0;
  for (const form of forms) {
    const deal = form.deal;
    if (!deal || deal.lostAt || deal.archivedAt) {
      skipped++;
      continue;
    }
    let config = orgConfig.get(form.orgId);
    if (!config) {
      config = await resolveEffectiveNotificationConfig(form.orgId);
      orgConfig.set(form.orgId, config);
    }
    if (!config.formReminder.enabled) {
      skipped++;
      continue;
    }
    const ageDays = Math.floor((now - form.createdAt.getTime()) / 86_400_000);
    if (!config.formReminder.days.includes(ageDays)) {
      skipped++;
      continue;
    }

    // Await inline: cron tem tempo de sobra e waitUntil em loop grande
    // competiria com o encerramento da function.
    await notifyDealEvent({
      dealId: deal.id,
      orgId: form.orgId,
      event: "form_reminder",
      dedupeKey: `d${ageDays}`,
      context: {
        formId: form.id,
        formPublicUrl: `${baseUrl}${formPublicPath(form.token, form.title)}`,
        extra: { ageDays },
      },
    });
    dispatched++;
  }

  return NextResponse.json({
    ok: true,
    scanned: forms.length,
    dispatched,
    skipped,
  });
}
