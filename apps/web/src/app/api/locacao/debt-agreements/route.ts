import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { debtAgreementCreateSchema } from "@/lib/locacao/validators";
import { dueDateFor, competenciaFor } from "@/lib/locacao/rent-scheduler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.DEBT_AGREEMENT_VIEW);
  if (isRouteError(ctx)) return ctx;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const agreements = await prisma.debtAgreement.findMany({
    where: { orgId: ctx.orgId, ...(status ? { status } : {}) },
    include: {
      tenant: { select: { id: true, nome: true } },
      _count: { select: { rentCharges: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ agreements });
}

/**
 * Cria DebtAgreement + materializa N parcelas como RentCharge {kind="acordo"}.
 * Cada parcela vence em (primeiraDataDue + N meses) — reusa `dueDateFor` para
 * clamp do último dia do mês.
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.DEBT_AGREEMENT_CREATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, debtAgreementCreateSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;

  const lc = await prisma.leaseContract.findFirst({
    where: { id: data.leaseContractId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!lc) return NextResponse.json({ error: "Contrato não pertence à org." }, { status: 422 });

  const tenant = await prisma.tenant.findFirst({
    where: { id: data.tenantId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ error: "Inquilino não pertence à org." }, { status: 422 });

  const parcelaValor = data.valorTotal / data.parcelas;
  const diaVencimento = data.primeiraDataDue.getDate();

  const result = await prisma.$transaction(async (tx) => {
    const agreement = await tx.debtAgreement.create({
      data: {
        orgId: ctx.orgId,
        leaseContractId: data.leaseContractId,
        tenantId: data.tenantId,
        valorTotal: data.valorTotal,
        componentesJson: data.componentes,
        parcelas: data.parcelas,
        primeiraDataDue: data.primeiraDataDue,
      },
    });

    for (let i = 0; i < data.parcelas; i++) {
      const offsetDate = new Date(data.primeiraDataDue);
      offsetDate.setMonth(offsetDate.getMonth() + i);
      const competencia = competenciaFor(offsetDate);
      const due = dueDateFor(competencia, diaVencimento);
      await tx.rentCharge.create({
        data: {
          orgId: ctx.orgId,
          leaseContractId: data.leaseContractId,
          kind: "acordo",
          debtAgreementId: agreement.id,
          competencia,
          dueDate: due,
          valorBase: parcelaValor,
          status: "pendente",
        },
      });
    }

    return agreement;
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "DEBT_AGREEMENT_CREATE",
      result: "SUCCESS",
      resource: result.id,
      resourceType: "DebtAgreement",
      metadata: { valorTotal: data.valorTotal, parcelas: data.parcelas },
    }
  );

  return NextResponse.json({ agreement: result }, { status: 201 });
}
