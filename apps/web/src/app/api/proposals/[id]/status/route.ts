import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";

export const runtime = "nodejs";

/**
 * GET /api/proposals/[id]/status — payload mínimo pra poll pós-ação (send/remind)
 * sem `router.refresh()` da página inteira. Só leitura; o scope é garantido pelo
 * loadScopedProposal (criador ou responsável).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { proposal } = r;

  const signers = await prisma.proposalSigner.findMany({
    where: { proposalId: proposal.id },
    orderBy: { signingGroup: "asc" },
    select: { id: true, name: true, role: true, acceptanceStatus: true, notifyChannel: true },
  });

  return NextResponse.json({
    status: proposal.status,
    updatedAt: proposal.updatedAt,
    lastReminderAt: proposal.lastReminderAt,
    reminderCount: proposal.reminderCount,
    signers,
  });
}
