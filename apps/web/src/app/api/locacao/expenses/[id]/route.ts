import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { expenseUpdateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.EXPENSE_EDIT);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.expense.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Despesa não encontrada" }, { status: 404 });

  const parsed = await parseJsonBody(req, expenseUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const isPaying = parsed.data.status === "pago" && !parsed.data.paidAt;
  const data = isPaying ? { ...parsed.data, paidAt: new Date() } : parsed.data;

  const expense = await prisma.expense.update({ where: { id }, data });
  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: data.status === "pago" ? "EXPENSE_PAY" : "EXPENSE_UPDATE",
      result: "SUCCESS",
      resource: id,
      resourceType: "Expense",
    }
  );
  return NextResponse.json({ expense });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.EXPENSE_DELETE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.expense.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true, rentChargeId: true },
  });
  if (!existing) return NextResponse.json({ error: "Despesa não encontrada" }, { status: 404 });
  if (existing.status === "pago") {
    return NextResponse.json(
      { error: "Despesa já paga não pode ser excluída — use cancelamento." },
      { status: 409 }
    );
  }

  await prisma.expense.delete({ where: { id } });
  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    { action: "EXPENSE_DELETE", result: "SUCCESS", resource: id, resourceType: "Expense" }
  );
  return NextResponse.json({ ok: true });
}
