import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import {
  eligibleModalidadesForDealKind,
  matchCriteriaSummary,
  modalidadeLabel,
} from "@/lib/contracts/template-category";

export const runtime = "nodejs";

/**
 * GET /api/pipeline/deals/:dealId/template-choices
 *
 * Modelos que este negócio pode usar, para o diálogo de "gerar com outro
 * modelo". A regra de elegibilidade mora AQUI e não no cliente: a mesma função
 * (`eligibleModalidadesForDealKind`) decide o que a lista mostra e o que o
 * POST de geração aceita, então a UI nunca oferece uma opção que a rota vai
 * recusar — nem esconde uma que ela aceitaria.
 *
 * Não diz qual seria o escolhido automaticamente: isso depende dos dados do
 * formulário e sairia caro (e mentiria assim que o formulário mudasse). O
 * diálogo apresenta o padrão da modalidade, que é estável.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { kind: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Mesmo gate da geração: quem não pode gerar não precisa da lista.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    permission: PERMISSION.CONTRACT_CREATE,
  });
  if (denied) return denied;

  const rows = await prisma.contractTemplate.findMany({
    where: {
      orgId: ctx.orgId,
      status: "active",
      modalidade: { in: eligibleModalidadesForDealKind(deal.kind) },
    },
    select: {
      id: true,
      name: true,
      modalidade: true,
      isDefault: true,
      matchCriteria: true,
    },
    orderBy: [{ modalidade: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({
    dealKind: deal.kind,
    templates: rows.map((t) => ({
      id: t.id,
      name: t.name,
      modalidade: t.modalidade,
      modalidadeLabel: modalidadeLabel(t.modalidade),
      isDefault: t.isDefault,
      // As mesmas badges da Central — dizem ao operador POR QUE um modelo
      // existe ("Seguro fiança", "Com administração") sem ele abrir Modelos.
      criteria: matchCriteriaSummary(t.matchCriteria),
    })),
  });
}
