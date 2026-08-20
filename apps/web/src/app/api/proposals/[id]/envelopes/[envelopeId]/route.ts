import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { cancelEnvelopeFlow } from "@/lib/clicksign/executor";
import { updateEnvelope } from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { onProposalEnvelopeCanceled } from "@/lib/proposals/webhook-hooks";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
});

/**
 * Espelho de `/api/contracts/[id]/envelopes/[envelopeId]` para propostas.
 *
 * Duas diferenças deliberadas em relação ao lado de contrato:
 *  - escopo por `loadScopedProposal` (criador OU responsável), não
 *    `guardContractScope` (que resolve org via `deal.pipeline`, e proposta não
 *    tem deal antes da conversão);
 *  - permissões do vocabulário de proposta: PROPOSAL_SEND para editar,
 *    PROPOSAL_CANCEL para cancelar — ENVELOPE_SEND é do fluxo de contrato e um
 *    corretor pode ter um sem o outro.
 */
async function loadProposalEnvelope(envelopeId: string, orgId: string, proposalId: string) {
  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, orgId },
    include: {
      signers: { orderBy: [{ signingGroup: "asc" }, { sourceIndex: "asc" }] },
    },
  });
  // O `proposalId` do envelope precisa bater com o da URL: sem isso, um id de
  // envelope de OUTRA proposta da mesma org passaria pelo escopo.
  if (!envelope || envelope.proposalId !== proposalId) return null;
  return envelope;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string } }
) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const envelope = await loadProposalEnvelope(params.envelopeId, auth.org.id, params.id);
  if (!envelope) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }
  if (envelope.status !== "draft" && envelope.status !== "running") {
    return NextResponse.json({ error: "Envelope não pode mais ser editado" }, { status: 400 });
  }
  if (envelope.status === "running" && parsed.data.name !== undefined) {
    return NextResponse.json(
      { error: "Não é possível alterar o nome de envelope em andamento" },
      { status: 400 }
    );
  }

  const deadlineAt =
    parsed.data.deadlineAt === undefined
      ? undefined
      : parsed.data.deadlineAt === null
        ? null
        : new Date(parsed.data.deadlineAt);

  if (envelope.clicksignId) {
    try {
      await updateEnvelope({
        envelopeId: envelope.clicksignId,
        name: parsed.data.name,
        deadlineAt,
      });
    } catch (err) {
      if (err instanceof ClicksignError) {
        return NextResponse.json({ error: `Clicksign: ${err.message}` }, { status: 502 });
      }
      throw err;
    }
  }

  const updated = await prisma.envelope.update({
    where: { id: envelope.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    },
    include: {
      signers: { orderBy: [{ signingGroup: "asc" }, { sourceIndex: "asc" }] },
    },
  });
  return NextResponse.json({ envelope: updated });
}

/**
 * Propaga o cancelamento pro status da PROPOSTA. Sem isto o envelope morria mas
 * a proposta seguia "aguardando assinatura", sem reenvio nem edição — presa até
 * o prazo vencer. `cause: "app"` marca que o cancelamento nasceu AQUI (botão
 * do corretor) — libera a 1ª via pra reenvio SEM sino (seria eco da ação
 * dele). Desde 2026-08-20 o webhook de `cancel` externo também libera, com a
 * mesma transição; a diferença entre os dois é só o sino (`send_canceled`,
 * que toca apenas quando o fato veio de fora).
 *
 * Best-effort: o envelope já foi cancelado na ClickSign e não dá pra desfazer —
 * estourar aqui devolveria erro pra uma ação que de fato aconteceu. O caminho
 * `alreadyCanceled` é o que dá o retry.
 */
async function propagateCancelToProposal(envelopeId: string): Promise<void> {
  try {
    await onProposalEnvelopeCanceled(envelopeId, "app");
  } catch (err) {
    console.error("[proposta envelope cancel] propagação de status falhou:", err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string } }
) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_CANCEL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const envelope = await loadProposalEnvelope(params.envelopeId, auth.org.id, params.id);
  if (!envelope) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }
  if (envelope.status === "closed") {
    return NextResponse.json({ error: "Envelope já finalizado" }, { status: 400 });
  }
  // Idempotente: recancelar não é erro (o botão pode ter sido clicado duas
  // vezes, ou o webhook já ter cancelado antes). A propagação roda IGUAL aqui
  // porque a resposta acima é `ok` sem ter mexido no status — sem isto, uma
  // segunda chamada nunca corrigiria uma propagação que falhou na primeira
  // (ela é best-effort e engole o erro).
  //
  // ATENÇÃO: hoje isto só é alcançável por chamada direta à API. O botão da UI
  // some quando o envelope vira `canceled` (`EnvelopeCard.canEdit` = draft |
  // running), então o cenário "cancelaram na ClickSign e o corretor clica aqui
  // pra destravar" NÃO existe pela tela. Enquanto o release da 1ª via for
  // exclusivo deste caminho, proposta cuja 1ª via morreu fora da plataforma
  // segue presa até expirar. Ver CHANGELOG.
  if (envelope.status === "canceled") {
    await propagateCancelToProposal(envelope.id);
    return NextResponse.json({ ok: true, alreadyCanceled: true });
  }

  try {
    await cancelEnvelopeFlow(envelope.id);
  } catch (err) {
    if (err instanceof ClicksignError) {
      return NextResponse.json({ error: `Clicksign: ${err.message}` }, { status: 502 });
    }
    throw err;
  }

  await prisma.proposalEvent
    .create({
      data: {
        proposalId: params.id,
        eventName: "envelope_canceled",
        source: "api",
        payload: { envelopeId: envelope.id, via: envelope.via },
      },
    })
    .catch(() => {});

  await propagateCancelToProposal(envelope.id);

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "ENVELOPE_CANCEL",
      result: "SUCCESS",
      resource: envelope.id,
      resourceType: "Envelope",
      metadata: { proposalId: params.id, via: envelope.via },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
