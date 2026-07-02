import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/deals/:dealId/serasa/consent
 *
 * Registra consentimento LGPD pra consultas Serasa do deal. Sem essa row no
 * `Deal.complianceJson.serasaConsent`, qualquer POST que enfileire endpoint
 * Serasa devolve 412 (`requiresConsent: true`).
 *
 * Body: { baseLegal: "protecao_credito" | "execucao_contrato" }
 *   - "protecao_credito"   : Lei 12.414/2011 + LGPD art. 7º, V (cadastro positivo).
 *   - "execucao_contrato"  : LGPD art. 7º, V (execução de contrato em fase
 *                            pré-contratual a pedido do titular).
 *
 * O consentimento é idempotente — POSTs subsequentes apenas refreshzam
 * `at`/`by`/`baseLegal`. Pra revogar, fazer DELETE.
 */

export const runtime = "nodejs";

const schema = z.object({
  baseLegal: z.enum(["protecao_credito", "execucao_contrato"]),
});

async function authorizeDeal(dealId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized", status: 401 as const };
  const org = await getUserOrg(session.user.id);
  if (!org) return { error: "No organization", status: 400 as const };
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      form: { select: { orgId: true } },
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return { error: "Deal not found", status: 404 as const };
  if (deal.pipeline.orgId !== org.id) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { deal, org, userId: session.user.id };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const result = await authorizeDeal(params.dealId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { deal, org, userId } = result;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { baseLegal } = parsed.data;

  const existing = (deal.complianceJson as Record<string, unknown> | null) ?? {};
  const consent = {
    at: new Date().toISOString(),
    by: userId,
    baseLegal,
  };
  await prisma.deal.update({
    where: { id: params.dealId },
    data: {
      complianceJson: {
        ...existing,
        serasaConsent: consent,
      },
    },
  });

  waitUntil(
    audit(
      { orgId: org.id, userId },
      {
        action: "SERASA_CONSENT_GIVEN",
        result: "SUCCESS",
        resource: params.dealId,
        resourceType: "Deal",
        metadata: { baseLegal },
      }
    )
  );

  return NextResponse.json({ ok: true, consent });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const result = await authorizeDeal(params.dealId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { deal, org, userId } = result;
  const existing = (deal.complianceJson as Record<string, unknown> | null) ?? {};
  // Remove apenas o consentimento Serasa; mantém o resto do compliance JSON.
  const { serasaConsent: _serasaConsent, ...rest } = existing;
  void _serasaConsent;
  await prisma.deal.update({
    where: { id: params.dealId },
    data: {
      complianceJson:
        Object.keys(rest).length > 0 ? (rest as Record<string, never>) : undefined,
    },
  });
  waitUntil(
    audit(
      { orgId: org.id, userId },
      {
        action: "SERASA_CONSENT_GIVEN",
        result: "DENIED",
        resource: params.dealId,
        resourceType: "Deal",
        metadata: { action: "revoked" },
      }
    )
  );
  return NextResponse.json({ ok: true });
}
