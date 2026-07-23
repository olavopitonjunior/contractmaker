import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { resendSignerAction } from "@/lib/clicksign/signer-actions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Estados em que ainda faz sentido lembrar (aguardando cliente/proprietário).
const REMINDABLE = new Set([
  "enviada",
  "entregue",
  "visualizada",
  "assinada_proponente",
  "aguardando_vendedor",
]);

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

  if (!REMINDABLE.has(proposal.status)) {
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

  const body = (await req.json().catch(() => ({}))) as { sourceKind?: string };
  const sourceKind =
    typeof body.sourceKind === "string" ? body.sourceKind : undefined;

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
  const errors: string[] = [];
  for (const s of signers) {
    const res = await resendSignerAction(s);
    if (res.ok) sent++;
    else errors.push(res.error);
  }
  if (sent === 0) {
    // Todos em cooldown / limite → 429 com a mensagem do helper.
    return NextResponse.json(
      { error: errors[0] ?? "Não foi possível reenviar agora.", errors },
      { status: 429 }
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
      metadata: { sent, skipped: errors.length, sourceKind: sourceKind ?? null },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, sent, skipped: errors.length });
}
