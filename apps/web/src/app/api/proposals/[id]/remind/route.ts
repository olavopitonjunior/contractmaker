import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { REMINDABLE_STATUSES } from "@/lib/proposals/status-sets";
import { resendSignerAction } from "@/lib/clicksign/signer-actions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ sourceKind: z.string().min(1).optional() });

/**
 * POST /api/proposals/[id]/remind — reenvia a notificação de assinatura para os
 * signatários pendentes do envelope em curso (cooldown 1h / máx 5 por signatário,
 * reusando `resendSignerAction`). Aceite via WhatsApp não tem esse caminho → 422.
 * Body opcional `{ sourceKind?: "vendedor"|"comprador"|... }` filtra a quem lembrar.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_RESEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  if (!REMINDABLE_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      { error: "Não há assinatura pendente para lembrar." },
      { status: 409 }
    );
  }
  if (proposal.instrument === "aceite") {
    return NextResponse.json(
      {
        error:
          "Reenvio de Aceite via WhatsApp não é suportado por aqui — use Sincronizar ou reenvie a proposta.",
      },
      { status: 422 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const sourceKind = parsed.data.sourceKind;

  const signers = await prisma.envelopeSigner.findMany({
    where: {
      envelope: { proposalId: proposal.id, status: "running" },
      status: { notIn: ["signed", "removed"] },
      ...(sourceKind ? { sourceKind } : {}),
    },
    include: { envelope: true },
  });
  if (signers.length === 0) {
    return NextResponse.json(
      { error: "Ninguém pendente para lembrar." },
      { status: 409 }
    );
  }

  let sent = 0;
  const errs: { status: number; error: string }[] = [];
  for (const s of signers) {
    const res = await resendSignerAction(s);
    if (res.ok) sent++;
    else errs.push({ status: res.status, error: res.error });
  }
  if (sent === 0) {
    // Propaga o status REAL do helper (não colapsa tudo em 429): 502 ClickSign
    // fora, 400 signatário em estado inválido, 429 cooldown/limite. Prioriza o
    // erro mais "duro" pra não mascarar uma falha real como rate-limit.
    const worst =
      errs.find((e) => e.status === 502) ??
      errs.find((e) => e.status === 400) ??
      errs[0] ?? { status: 429, error: "Não foi possível reenviar agora." };
    return NextResponse.json(
      { error: worst.error, errors: errs.map((e) => e.error) },
      { status: worst.status }
    );
  }

  await prisma.proposal.update({
    where: { id: proposal.id },
    data: { lastReminderAt: new Date(), reminderCount: { increment: 1 } },
  });
  await prisma.proposalEvent
    .create({
      data: { proposalId: proposal.id, eventName: "reminder_sent", source: "system" },
    })
    .catch(() => {});

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_REMIND",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: { sent, skipped: errs.length, sourceKind: sourceKind ?? null },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, sent, skipped: errs.length });
}
