import { NextRequest, NextResponse } from "next/server";
import { sweepStaleJobs } from "@/lib/certidoes/executor";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";

export const runtime = "nodejs";

/** POST /api/proposals/:id/certidoes/sweep — sweeper manual escopado à proposta (5 min). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: true });
  if ("fail" in r) return r.fail;
  const result = await sweepStaleJobs({ proposalId: r.scope.proposal.id, staleAfterMs: 5 * 60_000 });
  return NextResponse.json({
    promoted: result.promoted,
    requeued: result.requeued,
    failed: result.failed,
    swept: result.promoted + result.requeued + result.failed,
  });
}
