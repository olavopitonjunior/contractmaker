import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { aggregateSalesForYear } from "@/lib/dimob/aggregate-sales";
import { validateAggregate, hasBlockingErrors } from "@/lib/dimob/validate";
import { buildReviewRecords, markOverrides } from "@/lib/dimob/build-review";
import { applyOverrides, type DimobOverrideState } from "@/lib/dimob/apply-overrides";
import { DIMOB_LAYOUT_VERSION } from "@/lib/dimob/layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseYear(sp: URLSearchParams): number | null {
  const y = Number(sp.get("year"));
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  return y;
}

/**
 * GET /api/dimob/preview?year=YYYY
 * Agrega as vendas do ano, valida e devolve declarante + operações + pendências
 * para a tela revisar antes de gerar o TXT.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.REPORT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const year = parseYear(new URL(req.url).searchParams);
  if (year === null) {
    return NextResponse.json({ error: "Ano inválido" }, { status: 400 });
  }

  const aggregate0 = await aggregateSalesForYear(ctx.orgId, year);
  const [ov, org, exclusions] = await Promise.all([
    prisma.dimobOverride.findUnique({ where: { orgId_year: { orgId: ctx.orgId, year } } }),
    prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { dimobLayoutValidatedVersion: true },
    }),
    prisma.dimobExclusion.findMany({
      where: { orgId: ctx.orgId, year },
      select: { dealId: true, reason: true },
    }),
  ]);
  const state = (ov?.state as DimobOverrideState) ?? {};
  const aggregate = applyOverrides(aggregate0, state);
  const issues = validateAggregate(aggregate);

  const reviewRecords = buildReviewRecords(aggregate);
  markOverrides(reviewRecords, buildReviewRecords(aggregate0), state);

  // Resumo por deal das vendas excluídas (para a lista de conciliação).
  const reasonByDeal = new Map(exclusions.map((e) => [e.dealId, e.reason]));
  const excludedByDeal = new Map<
    string,
    { dealId: string; title: string; vendedor: string; comprador: string; valorAlienacao: number; dataOperacao: string; reason: string | null }
  >();
  for (const r of aggregate.excluded) {
    const cur = excludedByDeal.get(r.dealId);
    if (cur) {
      cur.valorAlienacao += r.valorAlienacao;
    } else {
      excludedByDeal.set(r.dealId, {
        dealId: r.dealId,
        title: r.dealTitle,
        vendedor: r.vendedor.nome,
        comprador: r.comprador.nome,
        valorAlienacao: r.valorAlienacao,
        dataOperacao: r.dataOperacao,
        reason: reasonByDeal.get(r.dealId) ?? null,
      });
    }
  }
  const excludedSales = [...excludedByDeal.values()];

  return NextResponse.json({
    year,
    declarante: aggregate.declarante,
    dispensado: aggregate.dispensado,
    records: aggregate.records,
    reviewRecords,
    excludedSales,
    issues,
    hasOverrides: Object.keys(state).length > 0,
    layoutValidated: org?.dimobLayoutValidatedVersion === DIMOB_LAYOUT_VERSION,
    canGenerate: !hasBlockingErrors(issues) && !aggregate.dispensado,
  });
}
