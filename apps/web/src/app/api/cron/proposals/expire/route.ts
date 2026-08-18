import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { advanceProposalStatus } from "@/lib/proposals/status";
import { EXPIRABLE_STATUSES } from "@/lib/proposals/status-sets";
import { notifyProposalMilestone } from "@/lib/proposals/notify-proposal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PATH = "/api/cron/proposals/expire";

/**
 * Expira propostas vencidas (validUntil < agora) que ainda esperam a 1ª
 * assinatura. NÃO expira `assinada_proponente`/`aguardando_vendedor` — aí já há
 * um comprador comprometido (bate com ALLOWED_FROM.expirada). O envelope na
 * ClickSign expira sozinho pelo deadline (= validUntil). Roda 06:30.
 */
export async function GET(req: NextRequest) {
  const authErr = requireCronAuth(req);
  if (authErr) return authErr;
  if (!(await isCronAllowedInStaging(PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: PATH });
  }

  const now = new Date();
  const props = await prisma.proposal.findMany({
    where: {
      validUntil: { lt: now },
      status: { in: [...EXPIRABLE_STATUSES] },
    },
    select: { id: true, orgId: true, userId: true },
    take: 300,
  });

  let expired = 0;
  for (const p of props) {
    const r = await advanceProposalStatus(p.id, "expirada", { expiredAt: now });
    if (!r.moved) continue;
    expired++;
    // Sem isto a proposta morria em silêncio: o status virava "expirada" às
    // 06:30 e o corretor só descobria abrindo a lista. Os caminhos de webhook
    // já tocavam o mesmo sino; só o cron não tocava. `notifyProposalMilestone`
    // nunca lança — não precisa de try/catch e não derruba o lote.
    await notifyProposalMilestone({
      proposalId: p.id,
      orgId: p.orgId,
      userId: p.userId,
      kind: "expired",
    });
  }
  return NextResponse.json({ ok: true, checked: props.length, expired });
}
