import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { resendSignerAction } from "@/lib/clicksign/signer-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PATH = "/api/cron/proposals/remind";
const OPEN = ["enviada", "entregue", "visualizada", "aguardando_vendedor"];

/**
 * Lembrete diário (13:00): reenvia a notificação de assinatura pros signatários
 * ainda ativos (pending/notified/email_failed) dos envelopes rodando de propostas
 * abertas. `resendSignerAction` já respeita cooldown 1h + máx 5 — o cron diário
 * nunca floda. NÃO roda em staging por padrão (dispara mensagem real).
 */
export async function GET(req: NextRequest) {
  const authErr = requireCronAuth(req);
  if (authErr) return authErr;
  if (!(await isCronAllowedInStaging(PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: PATH });
  }

  const signers = await prisma.envelopeSigner.findMany({
    where: {
      status: { in: ["pending", "notified", "email_failed"] },
      envelope: {
        source: "proposal",
        status: "running",
        proposal: { status: { in: OPEN } },
      },
    },
    include: { envelope: true },
    take: 300,
  });

  let reminded = 0;
  let skipped = 0;
  for (const s of signers) {
    const r = await resendSignerAction(s).catch(() => ({ ok: false as const }));
    if (r.ok) reminded++;
    else skipped++;
  }
  return NextResponse.json({ ok: true, candidates: signers.length, reminded, skipped });
}
