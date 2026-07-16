import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus } from "@/lib/proposals/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/proposals/[token]/seen — BEACON de visualização (§9.1).
 *
 * Público (o cliente não tem conta), disparado pelo browser no mount da landing.
 * Só ESTE sinal vira `visualizada` — o GET da página NÃO, porque crawlers
 * (WhatsApp/Gmail/scanners) buscam a URL pra montar preview e marcariam toda
 * proposta como vista segundos após o envio. Bots não executam JS → não batem no
 * beacon. Idempotente (CAS): só move de enviada/entregue.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const proposal = await prisma.proposal.findUnique({
    where: { token: params.token },
    select: { id: true, status: true, firstViewedAt: true },
  });
  // 200 genérico mesmo pra token inválido — beacon não vaza existência.
  if (!proposal) return NextResponse.json({ ok: true });

  // ipHash = sha256(ip + AUTH_SECRET), nunca o IP cru (LGPD).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ipHash = createHash("sha256")
    .update(ip + (process.env.AUTH_SECRET ?? ""))
    .digest("hex")
    .slice(0, 32);

  await prisma.proposalEvent
    .create({
      data: { proposalId: proposal.id, eventName: "viewed", source: "beacon", ipHash },
    })
    .catch(() => {});

  await prisma.proposal
    .update({
      where: { id: proposal.id },
      data: {
        viewCount: { increment: 1 },
        ...(proposal.firstViewedAt ? {} : { firstViewedAt: new Date() }),
        lastViewedAt: new Date(),
      },
    })
    .catch(() => {});

  // Move pra "visualizada" só de enviada/entregue (CAS no-op nos demais).
  if (["enviada", "entregue"].includes(proposal.status)) {
    await advanceProposalStatus(proposal.id, "visualizada");
  }

  return NextResponse.json({ ok: true });
}
