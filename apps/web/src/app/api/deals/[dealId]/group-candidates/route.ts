import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { computeDealGroupCandidates } from "@/lib/newton/group-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/:dealId/group-candidates
 *
 * Para a UI escolher o grupo do negócio quando o auto-match foi fraco/ambíguo.
 * Retorna o vínculo atual (se houver) e os grupos candidatos (ranqueados por
 * quantos telefones de partes batem). PURO — não grava nada.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:r" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { orgId: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== auth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const r = await computeDealGroupCandidates(params.dealId);
  if (!r) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  return NextResponse.json({
    linkedGroupId: r.existingGroupId,
    strong: r.strong,
    candidates: r.candidates,
  });
}
