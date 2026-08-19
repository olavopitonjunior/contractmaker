import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  generateContractForDeal,
  generateLocacaoContractForDeal,
} from "@/lib/services/contract-generation";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  // `ctx.userId` é o ator EFETIVO: sob impersonation, o dono do tenant. É ele
  // que tem membership na org (RBAC do `guardDealScope`) e é ele que deve
  // constar como autor do contrato gerado — o super_admin real fica carimbado
  // no AuditLog por `audit()` (metadata `impersonatedBy`).
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    // Deals de locação usam o gerador próprio (template por schemaType +
    // enrichLocacaoData + upsert do LeaseContract). Os asserts de módulo
    // ficam dentro de cada gerador.
    const deal = await prisma.deal.findUnique({
      where: { id: params.dealId },
      select: { kind: true },
    });
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Cross-org + escopo do gerente + CONTRACT_CREATE. Esta rota não tinha
    // checagem de org própria — o guard fecha as duas coisas.
    const denied = await guardDealScope({
      dealId: params.dealId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CONTRACT_CREATE,
    });
    if (denied) return denied;

    const generate =
      deal.kind === "locacao"
        ? generateLocacaoContractForDeal
        : generateContractForDeal;
    const result = await generate(params.dealId, ctx.userId, ctx.orgId);

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("Generate contract error:", error);
    return NextResponse.json(
      { error: error.message || "Erro ao gerar contrato" },
      { status: 400 }
    );
  }
}
