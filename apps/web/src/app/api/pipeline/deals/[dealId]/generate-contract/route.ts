import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  generateContractForDeal,
  generateLocacaoContractForDeal,
} from "@/lib/services/contract-generation";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

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
      userId: session.user.id,
      orgId: org.id,
      permission: PERMISSION.CONTRACT_CREATE,
    });
    if (denied) return denied;

    const generate =
      deal.kind === "locacao"
        ? generateLocacaoContractForDeal
        : generateContractForDeal;
    const result = await generate(params.dealId, session.user.id, org.id);

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("Generate contract error:", error);
    return NextResponse.json(
      { error: error.message || "Erro ao gerar contrato" },
      { status: 400 }
    );
  }
}
