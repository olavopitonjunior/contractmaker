import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { ModuleDisabledError } from "@/lib/modules/guard";
import { assertAnySurveyFeature } from "@/lib/surveys/guard";
import { resolveDealRecipients } from "@/lib/surveys/recipients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/surveys/recipients?dealId= — destinatários sugeridos do deal
// (partes do form + corretor) pro dialog de envio manual, e templates ativos
// (isLatest) pra escolher qual pesquisa enviar.
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);
  try {
    await assertAnySurveyFeature(auth.org.id);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const dealId = new URL(req.url).searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId obrigatório" }, { status: 400 });
  }

  const resolved = await resolveDealRecipients(dealId);
  if (!resolved || resolved.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Negócio não encontrado" }, { status: 404 });
  }

  const [templates, optouts] = await Promise.all([
    prisma.surveyTemplate.findMany({
      where: { orgId: auth.org.id, isLatest: true, status: "active" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, version: true },
    }),
    prisma.surveyInvite.findMany({
      where: { orgId: auth.org.id, status: "optout", recipientEmail: { not: null } },
      select: { recipientEmail: true },
      distinct: ["recipientEmail"],
    }),
  ]);
  const optedOut = new Set(optouts.map((o) => o.recipientEmail));

  return NextResponse.json({
    dealKind: resolved.dealKind,
    // `optedOut`: o destinatário pediu pra não receber — o dialog avisa e não
    // pré-seleciona; o envio manual segue possível (decisão do operador).
    recipients: resolved.recipients.map((r) => ({
      ...r,
      optedOut: r.email ? optedOut.has(r.email) : false,
    })),
    templates,
  });
}
