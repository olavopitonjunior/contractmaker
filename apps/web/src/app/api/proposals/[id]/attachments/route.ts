import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";

export const runtime = "nodejs";

/**
 * GET /api/proposals/:id/attachments — lista os documentos da proposta com o
 * estado de OCR (polling leve do card). Escopo = quem pode VER a proposta.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;

  const rows = await prisma.proposalAttachment.findMany({
    where: { proposalId: r.proposal.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      filename: true,
      mime: true,
      url: true,
      category: true,
      source: true,
      status: true,
      extractError: true,
      extractedData: true,
      certidaoJobId: true,
      createdAt: true,
    },
  });
  return NextResponse.json({
    attachments: rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  });
}
