import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";

export const dynamic = "force-dynamic";

const bulkExpensesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(["liquidar", "estornar", "marcar_pendente", "cancelar"]),
});

/**
 * POST /api/locacao/expenses/bulk
 * Ações em massa em Expense: liquidar/estornar/marcar pendente/cancelar.
 * Cross-org guard via filtro WHERE orgId.
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.EXPENSE_EDIT);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, bulkExpensesSchema);
  if (!parsed.ok) return parsed.response;

  const now = new Date();
  const updateData = (() => {
    switch (parsed.data.action) {
      case "liquidar":
        return { status: "pago", paidAt: now };
      case "estornar":
        return { status: "pendente", paidAt: null };
      case "marcar_pendente":
        return { status: "pendente" };
      case "cancelar":
        return { status: "cancelado" };
    }
  })();

  const result = await prisma.expense.updateMany({
    where: { id: { in: parsed.data.ids }, orgId: ctx.orgId },
    data: updateData,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: parsed.data.action === "liquidar" ? "EXPENSE_PAY" : "EXPENSE_UPDATE",
      result: "SUCCESS",
      resource: parsed.data.ids[0],
      resourceType: "Expense",
      metadata: {
        bulk: true,
        action: parsed.data.action,
        affected: result.count,
        requested: parsed.data.ids.length,
      },
    }
  );

  return NextResponse.json({ ok: true, affected: result.count });
}
