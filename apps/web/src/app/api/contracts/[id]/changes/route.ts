import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

export const runtime = "nodejs";

/**
 * GET /api/contracts/[id]/changes?sessionId=...&onlyDiffs=true
 *
 * Lista ContractChangeLog do contrato. Filtros opcionais:
 *  - sessionId: filtra turns daquela session de chat
 *  - onlyDiffs=true: descarta entries sem htmlBefore/htmlAfter (i.e., só
 *    write tools que produziram snapshot)
 *
 * Retorna o htmlBefore/htmlAfter pra UI calcular diff client-side via lib
 * `diff` (não precisa enviar diff já calculado, evita server cost).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      userId: true,
      deal: { select: { pipeline: { select: { orgId: true } } } },
    },
  });
  // Cross-org check pra session E bearer — 404 pra não vazar existência.
  if (!contract || contract.deal.pipeline.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  if (auth.ident.via === "bearer" && contract.userId !== auth.ident.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const onlyDiffs = req.nextUrl.searchParams.get("onlyDiffs") === "true";

  const logs = await prisma.contractChangeLog.findMany({
    where: {
      contractId: params.id,
      // AND de dois OR (Prisma não aceita duas chaves `OR` no mesmo nível).
      AND: [
        // Filtro de sessão: human_doc_edit não tem sessionId (vem do webhook do
        // Drive, fora de qualquer chat) — ainda assim deve aparecer na visão
        // "Esta sessão" (senão a atribuição manual só apareceria em "Todas").
        ...(sessionId
          ? [{ OR: [{ sessionId }, { action: "human_doc_edit" }] }]
          : []),
        // onlyDiffs: entries com snapshot (write tools) OU edições manuais
        // humanas (human_doc_edit é atribuição sem diff — o valor é o "quem/quando").
        ...(onlyDiffs
          ? [
              {
                OR: [
                  { htmlBefore: { not: null }, htmlAfter: { not: null } },
                  { action: "human_doc_edit" },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      action: true,
      summary: true,
      source: true,
      createdAt: true,
      htmlBefore: true,
      htmlAfter: true,
      sessionId: true,
    },
  });

  return NextResponse.json(
    logs.map((l) => ({
      id: l.id,
      action: l.action,
      summary: l.summary,
      source: l.source,
      createdAt: l.createdAt.toISOString(),
      sessionId: l.sessionId,
      hasDiff: !!l.htmlBefore && !!l.htmlAfter && l.htmlBefore !== l.htmlAfter,
      htmlBefore: l.htmlBefore,
      htmlAfter: l.htmlAfter,
    }))
  );
}
