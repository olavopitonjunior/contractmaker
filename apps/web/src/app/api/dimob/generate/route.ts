import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { aggregateSalesForYear } from "@/lib/dimob/aggregate-sales";
import { aggregateLeasesForYear } from "@/lib/dimob/aggregate-lease";
import {
  validateAggregate,
  validateLeaseRecords,
  hasBlockingErrors,
} from "@/lib/dimob/validate";
import { buildDimobFileFromAggregate } from "@/lib/dimob/build-file";
import {
  applyOverrides,
  applyLeaseOverrides,
  type DimobOverrideState,
} from "@/lib/dimob/apply-overrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseYear(sp: URLSearchParams): number | null {
  const y = Number(sp.get("year"));
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  return y;
}

/**
 * POST /api/dimob/generate?year=YYYY
 * Gera o TXT da DIMOB de vendas do ano. Bloqueia (422) se houver pendências
 * obrigatórias ou se não houver operações (dispensada). Persiste DimobExport,
 * audita e devolve o arquivo como download.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.REPORT_EXPORT,
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

  const [aggregate0, leaseAgg0] = await Promise.all([
    aggregateSalesForYear(ctx.orgId, year),
    aggregateLeasesForYear(ctx.orgId, year),
  ]);
  const ov = await prisma.dimobOverride.findUnique({
    where: { orgId_year: { orgId: ctx.orgId, year } },
  });
  const state = (ov?.state as DimobOverrideState) ?? null;
  const aggregate = applyOverrides(aggregate0, state);
  const leaseRecords = applyLeaseOverrides(leaseAgg0.records, state);

  if (aggregate.records.length === 0 && leaseRecords.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma operação de venda ou locação no ano — DIMOB dispensada (FAQ RFB p6)." },
      { status: 422 }
    );
  }

  const issues = [
    ...validateAggregate(aggregate),
    ...validateLeaseRecords(leaseRecords),
  ];
  if (hasBlockingErrors(issues)) {
    return NextResponse.json(
      { error: "Há pendências obrigatórias que impedem a geração.", issues },
      { status: 422 }
    );
  }

  const built = buildDimobFileFromAggregate(aggregate, leaseRecords);

  await prisma.dimobExport.create({
    data: {
      orgId: ctx.orgId,
      year,
      recordCount: built.recordCount,
      totalOperacoes: built.totalOperacoes,
      totalComissao: built.totalComissao,
      contentHash: built.contentHash,
      generatedByUserId: ctx.userId,
    },
  });

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "DIMOB_GENERATED",
    result: "SUCCESS",
    resource: ctx.orgId,
    resourceType: "DimobExport",
    metadata: {
      year,
      recordCount: built.recordCount,
      totalOperacoes: built.totalOperacoes,
      totalComissao: built.totalComissao,
      contentHash: built.contentHash,
    },
  });

  return new NextResponse(built.txt, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="DIMOB_${year}.txt"`,
    },
  });
}
