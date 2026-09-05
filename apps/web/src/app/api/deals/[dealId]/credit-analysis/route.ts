import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { FEATURE } from "@/lib/modules/catalog";
import { readCreditConsent } from "@/lib/credit/consent";
import { listCreditRequests } from "@/lib/credit/analysis-view";
import { isFichaCertaConfigured } from "@/lib/fichacerta/account";

export const runtime = "nodejs";

/**
 * GET /api/deals/:dealId/credit-analysis — análise de crédito (Ficha Certa)
 * que veio da proposta convertida. Só leitura: o re-disparo pelo negócio está
 * fora do MVP (o card aponta para a proposta de origem). A projeção é a mesma
 * da proposta (`lib/credit/analysis-view.ts`) — o laudo PDF sai pelo
 * `DealAttachment` casado na conversão.
 */
export async function GET(_req: NextRequest, { params }: { params: { dealId: string } }) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_VIEW, FEATURE.LOCACAO_CREDITO);
  if (isRouteError(ctx)) return ctx;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      kind: true,
      complianceJson: true,
      pipeline: { select: { orgId: true } },
      fromProposal: { select: { id: true } },
    },
  });
  if (!deal || deal.kind !== "locacao" || deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  const denied = await guardDealScope({ dealId: deal.id, userId: ctx.userId, orgId: ctx.orgId });
  if (denied) return denied;

  return NextResponse.json({
    configured: await isFichaCertaConfigured(ctx.orgId),
    consent: readCreditConsent(deal.complianceJson),
    originProposalId: deal.fromProposal?.id ?? null,
    requests: await listCreditRequests({ dealId: deal.id }),
  });
}
