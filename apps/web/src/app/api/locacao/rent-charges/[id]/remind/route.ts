import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { dunningExecutor, type DunningStage } from "@/lib/locacao/executors/dunning";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

const remindRequestSchema = z.object({
  stage: z
    .enum([
      "lembrete_d_minus_3",
      "atraso_d_plus_1",
      "formal_d_plus_5",
      "extrajudicial_d_plus_30",
      "garantia_d_plus_60",
    ])
    .optional(),
});

/**
 * POST /api/locacao/rent-charges/[id]/remind
 * Dispara a régua de cobrança via Newton (cria NewtonRequest tipado).
 * Sem HITL — régua é automática.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.RENT_REMIND);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const parsed = await parseJsonBody(req, remindRequestSchema);
  if (!parsed.ok) return parsed.response;

  const result = await dunningExecutor({
    rentChargeId: id,
    orgId: ctx.orgId,
    userId: ctx.userId,
    stage: parsed.data.stage as DunningStage | undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 422 });
  }
  return NextResponse.json({ ok: true, newtonRequestId: result.requestId });
}
