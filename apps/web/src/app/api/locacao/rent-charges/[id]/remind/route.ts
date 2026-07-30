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
 *
 * Registra a etapa da régua de cobrança como `NewtonRequest` tipada. **Não envia
 * mensagem.** Desde 2026-07-25 (PR #193) o cron de sweep que levava essas rows ao
 * WhatsApp foi removido, e o executor nunca chamou `triggerNewtonForRequest` direto.
 * Na prática já era inerte antes disso: o trigger é gated por `locacao.newton`, que
 * está OFF em todos os tenants. Hoje isto é anotação — quem cobra é pessoa.
 *
 * Sem HITL.
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
