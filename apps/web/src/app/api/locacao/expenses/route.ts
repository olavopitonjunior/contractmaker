import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { expenseCreateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.EXPENSE_VIEW);
  if (isRouteError(ctx)) return ctx;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const leaseContractId = url.searchParams.get("leaseContractId");
  const monthIso = url.searchParams.get("month"); // YYYY-MM

  let dateFilter = {};
  if (monthIso && /^\d{4}-\d{2}$/.test(monthIso)) {
    const [y, m] = monthIso.split("-").map(Number);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 1);
    dateFilter = { dueDate: { gte: from, lt: to } };
  }

  const expenses = await prisma.expense.findMany({
    where: {
      orgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(leaseContractId ? { leaseContractId } : {}),
      ...dateFilter,
    },
    include: {
      leaseContract: { select: { id: true, property: { select: { rua: true, numero: true } } } },
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });
  return NextResponse.json({ expenses });
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.EXPENSE_CREATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, expenseCreateSchema);
  if (!parsed.ok) return parsed.response;

  // Cross-org guard nos FKs.
  const data = parsed.data;
  if (data.leaseContractId) {
    const lc = await prisma.leaseContract.findFirst({
      where: { id: data.leaseContractId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!lc) {
      return NextResponse.json({ error: "Contrato não pertence à org." }, { status: 422 });
    }
  }
  if (data.propertyId) {
    const p = await prisma.property.findFirst({
      where: { id: data.propertyId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!p) {
      return NextResponse.json({ error: "Imóvel não pertence à org." }, { status: 422 });
    }
  }

  const expense = await prisma.expense.create({
    data: { ...data, orgId: ctx.orgId },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "EXPENSE_CREATE",
      result: "SUCCESS",
      resource: expense.id,
      resourceType: "Expense",
      metadata: { type: expense.type, valor: expense.valor, leaseContractId: expense.leaseContractId },
    }
  );

  return NextResponse.json({ expense }, { status: 201 });
}
