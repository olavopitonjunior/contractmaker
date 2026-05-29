import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { simulateRepasse, type ChargeInput } from "@/lib/locacao/repasse-simulator";

export const dynamic = "force-dynamic";

const simularSchema = z.object({
  rentChargeIds: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * POST /api/locacao/repasses/simular — preview de repasse SEM mutar dados.
 * Calcula líquido por proprietário (com %), IR retido conforme regimeIr,
 * taxa adm deduzida da imobiliária.
 *
 * Não altera estado — apenas devolve o cálculo pra UI mostrar antes do user
 * clicar em "Realizar repasse".
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.RENT_VIEW);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, simularSchema);
  if (!parsed.ok) return parsed.response;

  const charges = await prisma.rentCharge.findMany({
    where: {
      id: { in: parsed.data.rentChargeIds },
      orgId: ctx.orgId,
      status: "paga",
    },
    include: {
      leaseContract: {
        select: {
          taxaAdminPercent: true,
          regimeIr: true,
          property: {
            include: {
              ownerships: { include: { owner: { select: { id: true, nome: true } } } },
            },
          },
        },
      },
    },
  });

  const inputs: ChargeInput[] = [];
  for (const c of charges) {
    const lc = c.leaseContract;
    if (!lc) continue;
    inputs.push({
      rentChargeId: c.id,
      competencia: c.competencia,
      valorBase: c.valorBase,
      encargos: c.encargos,
      taxaAdminPercent: lc.taxaAdminPercent,
      regimeIr: lc.regimeIr,
      ownerships: (lc.property?.ownerships ?? []).map((o) => ({
        ownerId: o.owner.id,
        nome: o.owner.nome,
        percentual: o.percentual,
      })),
    });
  }

  return NextResponse.json(simulateRepasse(inputs));
}
