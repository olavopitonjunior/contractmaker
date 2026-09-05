import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { TERMINAL_STATUSES } from "@/lib/proposals/status-sets";
import { applyScopedProposalWrite, proposalConflictResponse } from "@/lib/proposals/cas";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { readCreditConsent, withCreditConsent, withoutCreditConsent } from "@/lib/credit/consent";

export const runtime = "nodejs";

const schema = z.object({
  baseLegal: z.enum(["protecao_credito", "execucao_contrato"]),
});

/** Provedor vigente da análise de crédito na proposta (informativo no registro). */
const CREDIT_PROVIDER = "fichacerta";

function authz(r: Awaited<ReturnType<typeof loadScopedProposal>>) {
  if ("fail" in r) return r.fail;
  const { eff, proposal } = r;
  if (!can(eff, PERMISSION.PROPOSAL_CREATE) && !can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (TERMINAL_STATUSES.has(proposal.status)) {
    return NextResponse.json({ error: "Proposta encerrada." }, { status: 409 });
  }
  return null;
}

/**
 * POST /api/proposals/[id]/credit/consent — registra o consentimento LGPD
 * para a análise de crédito dos pretendentes desta proposta.
 *
 * Grava na chave canônica `complianceJson.creditConsent` (`lib/credit/consent`)
 * com `provider: "fichacerta"`; o gate do disparo (PR 6) lê pela mesma
 * função, que também aceita o legado `serasaConsent`. Idempotente: POSTs
 * seguintes só refrescam `at`/`by`/`baseLegal`. O consentimento é copiado
 * para `Deal.complianceJson` na conversão.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  const denied = authz(r);
  if (denied) return denied;
  const { auth, proposal } = r as Exclude<typeof r, { fail: unknown }>;
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const consent = {
    at: new Date().toISOString(),
    by: auth.actor.effectiveUserId,
    baseLegal: parsed.data.baseLegal,
    provider: CREDIT_PROVIDER,
  };
  // CAS com re-tentativa (issue #610): sem casar o `updatedAt`, o
  // consentimento sobrescreveria em silêncio outra escrita concorrente no
  // complianceJson. O patch é uma chave só, então é reaplicado sobre o
  // estado fresco em vez de virar 409 na primeira corrida.
  const written = await applyScopedProposalWrite(
    proposal.id,
    { updatedAt: proposal.updatedAt, dataJson: proposal.dataJson, complianceJson: proposal.complianceJson },
    (cur) => ({ complianceJson: withCreditConsent(cur.complianceJson, consent) as Prisma.InputJsonValue })
  );
  if (!written.ok) {
    return proposalConflictResponse(written.reason, "Proposta encerrada.");
  }

  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: "credit_consent_given",
        source: "system",
        payload: { baseLegal: consent.baseLegal, provider: CREDIT_PROVIDER },
      },
    })
    .catch(() => {});
  await audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
    action: "CREDIT_CONSENT_GIVEN",
    result: "SUCCESS",
    resource: proposal.id,
    resourceType: "Proposal",
    metadata: { baseLegal: consent.baseLegal, provider: CREDIT_PROVIDER },
  }).catch(() => {});

  return NextResponse.json({ ok: true, consent });
}

/** DELETE — revoga (apaga a chave canônica e a legada). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  const denied = authz(r);
  if (denied) return denied;
  const { auth, proposal } = r as Exclude<typeof r, { fail: unknown }>;
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const had = readCreditConsent(proposal.complianceJson);
  if (!had) return NextResponse.json({ ok: true, consent: null });

  // Mesmo guard do POST: se a proposta virou terminal no meio, a revogação
  // não pode responder "ok" sem ter escrito.
  const revoked = await applyScopedProposalWrite(
    proposal.id,
    { updatedAt: proposal.updatedAt, dataJson: proposal.dataJson, complianceJson: proposal.complianceJson },
    (cur) => ({ complianceJson: withoutCreditConsent(cur.complianceJson) as Prisma.InputJsonValue })
  );
  if (!revoked.ok) {
    return proposalConflictResponse(revoked.reason, "Proposta encerrada.");
  }
  await prisma.proposalEvent
    .create({
      data: { proposalId: proposal.id, eventName: "credit_consent_revoked", source: "system" },
    })
    .catch(() => {});
  await audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
    action: "CREDIT_CONSENT_REVOKED",
    result: "SUCCESS",
    resource: proposal.id,
    resourceType: "Proposal",
    metadata: { previousBaseLegal: had.baseLegal },
  }).catch(() => {});

  return NextResponse.json({ ok: true, consent: null });
}
