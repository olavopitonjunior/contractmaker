import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { ClicksignError } from "@/lib/clicksign/client";
import { syncEnvelopeState, EnvelopeNotSyncableError } from "@/lib/clicksign/sync";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/deals/[dealId]/envelopes/[envelopeId]/sync
 *
 * Igual ao sync de contrato, mas escopado por deal — serve envelopes avulsos
 * (source="attachment") da pasta Documentos. Lógica em `lib/clicksign/sync.ts`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req, { scope: "signatures:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const envelope = await prisma.envelope.findFirst({
    where: { id: params.envelopeId, dealId: params.dealId, orgId: ctx.orgId },
    include: { signers: true },
  });
  if (!envelope) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }

  // Escopo do gerente + ENVELOPE_SEND (o sync escreve estado do envelope).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    via: ctx.via,
    permission: PERMISSION.ENVELOPE_SEND,
  });
  if (denied) return denied;

  const debug = new URL(req.url).searchParams.get("debug") === "1";

  try {
    const result = await syncEnvelopeState(envelope, { actorVia: ctx.via, debug });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EnvelopeNotSyncableError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ClicksignError) {
      return NextResponse.json(
        { error: `Clicksign: ${err.message}`, status: err.status },
        { status: 502 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[deal envelope sync] erro:", msg);
    return NextResponse.json({ error: msg || "Erro interno" }, { status: 500 });
  }
}
