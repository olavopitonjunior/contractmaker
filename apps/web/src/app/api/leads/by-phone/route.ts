import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

export const runtime = "nodejs";

/**
 * GET /api/leads/by-phone?phone=+5511987654321
 *
 * **Crítico pro multi-deal disambiguation do Newton.** Toda mensagem WhatsApp
 * recebida deve passar por aqui ANTES de Newton responder, pra evitar
 * misturar contextos.
 *
 * Retorna leads abertas/qualificadas que tem o phone na array `phones`.
 * Se mais de 1 → Newton pergunta qual antes de prosseguir.
 */
export async function GET(req: NextRequest) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const url = new URL(req.url);
  const phone = url.searchParams.get("phone");
  if (!phone || !/^\+\d{10,15}$/.test(phone)) {
    return NextResponse.json(
      { error: "phone obrigatório no formato E.164 (+5511987654321)" },
      { status: 400 }
    );
  }

  const leads = await prisma.lead.findMany({
    where: {
      orgId: apiAuth.org.id,
      status: { in: ["open", "qualified"] },
      phones: { has: phone },
    },
    orderBy: { lastActivityAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      phones: true,
      lastActivityAt: true,
      metadata: true,
    },
  });

  return NextResponse.json({ phone, leads, matchCount: leads.length });
}
