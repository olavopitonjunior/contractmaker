import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";

export const runtime = "nodejs";

/**
 * GET /api/proposals/[id]/envelopes — envelopes ClickSign da proposta.
 *
 * Existia o pipeline inteiro (`Envelope.proposalId`, `source="proposal"`,
 * `via` completa/reduzida) mas nenhuma rota que o expusesse — o detalhe da
 * proposta só via os signatários via `/status`, sem status/custo/prazo/PDF do
 * envelope. Esta rota devolve o MESMO shape (`EnvelopeRow`) que
 * `/api/contracts/[id]/envelopes`, que é o contrato do `<EnvelopeCard />`.
 *
 * Ordem: `via` ASC → "completa" (1ª via, do proponente) antes de "reduzida"
 * (2ª via, do proprietário), que é a ordem cronológica do encadeamento.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;

  const envelopes = await prisma.envelope.findMany({
    where: { proposalId: params.id },
    include: {
      signers: { orderBy: [{ signingGroup: "asc" }, { sourceIndex: "asc" }] },
    },
    orderBy: [{ via: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ envelopes });
}
