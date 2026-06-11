import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { dunningExecutor } from "@/lib/locacao/executors/dunning";

export const dynamic = "force-dynamic";

const bulkChargesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["reenviar", "cancelar", "cobrar"]),
});

/**
 * POST /api/locacao/rent-charges/bulk
 * Ações em massa em RentCharge: reenviar boleto, cancelar, cobrar (dunning).
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.RENT_REMIND);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, bulkChargesSchema);
  if (!parsed.ok) return parsed.response;

  let affected = 0;

  if (parsed.data.action === "cancelar") {
    const c = await ensureLocacaoAccess(PERMISSION.RENT_GENERATE);
    if (isRouteError(c)) return c;
    const r = await prisma.rentCharge.updateMany({
      where: {
        id: { in: parsed.data.ids },
        orgId: ctx.orgId,
        status: { in: ["pendente", "emitida", "atrasada"] },
      },
      data: { status: "cancelada" },
    });
    affected = r.count;
  } else if (parsed.data.action === "cobrar") {
    // Dispara dunningExecutor pra cada (stop-on-first-error é OK aqui).
    for (const id of parsed.data.ids) {
      const r = await dunningExecutor({ rentChargeId: id, orgId: ctx.orgId, userId: ctx.userId });
      if (r.ok) affected++;
    }
  } else {
    // reenviar: por ora, no-op (depende de integração Asaas resend) — vira FASE 4
    return NextResponse.json(
      { error: "Reenvio de boleto ainda não integrado com Asaas (Fase 4)" },
      { status: 501 }
    );
  }

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: parsed.data.action === "cobrar" ? "RENT_REMIND" : "RENT_CHARGE_CANCEL",
      result: "SUCCESS",
      resource: parsed.data.ids[0],
      resourceType: "RentCharge",
      metadata: {
        bulk: true,
        action: parsed.data.action,
        affected,
        requested: parsed.data.ids.length,
      },
    }
  );

  return NextResponse.json({ ok: true, affected });
}
