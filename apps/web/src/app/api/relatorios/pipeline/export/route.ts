import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { requireAuth } from "@/lib/auth/context";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { getPipelineReport } from "@/lib/pipeline/reports";
import { getFunnelByChannel } from "@/lib/pipeline/funnel";

export const runtime = "nodejs";

/**
 * CSV do relatório do pipeline (PR 3.7). Gate REPORT_EXPORT (mais restrito
 * que o REPORT_VIEW da tela). Formato pt-BR: delimitador ";" (Excel BR trata
 * "," como decimal) + BOM UTF-8 (sem ele o Excel lê acento como mojibake).
 * `?tabela=etapas|corretores|canais` escolhe a visão exportada.
 */

const PERIOD_DAYS: Record<string, number | null> = {
  "30d": 30,
  "90d": 90,
  "12m": 365,
  all: null,
};

const num = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

export async function GET(req: NextRequest) {
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
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "locacao" ? "locacao" : "venda";
  const periodo = url.searchParams.get("periodo") ?? "90d";
  const tabela = url.searchParams.get("tabela") ?? "etapas";
  const incluirEstimados = url.searchParams.get("incluirEstimados") === "1";
  if (!(periodo in PERIOD_DAYS)) {
    return NextResponse.json({ error: "periodo inválido" }, { status: 400 });
  }
  if (!["etapas", "corretores", "canais"].includes(tabela)) {
    return NextResponse.json({ error: "tabela inválida" }, { status: 400 });
  }
  const days = PERIOD_DAYS[periodo];
  const from = days ? new Date(Date.now() - days * 86_400_000) : undefined;

  let rows: Record<string, string | number>[];
  if (tabela === "canais") {
    const data = await getFunnelByChannel({ orgId: ctx.orgId, kind, from });
    rows = data.map((r) => ({
      Canal: r.label,
      Criados: r.total,
      Ganhos: r.won,
      Perdidos: r.lost,
      "Conversão (%)": r.conversionPct,
      "Valor (R$)": num(r.totalValue),
    }));
  } else {
    const report = await getPipelineReport({
      orgId: ctx.orgId,
      kind,
      from,
      incluirEstimados,
    });
    rows =
      tabela === "corretores"
        ? report.byBroker.map((r) => ({
            Responsável: r.label,
            Criados: r.total,
            Ganhos: r.won,
            Perdidos: r.lost,
            "Conversão (%)": r.conversionPct,
            "Valor (R$)": num(r.totalValue),
          }))
        : report.stages.map((s) => ({
            Etapa: s.stageName,
            Passaram: s.dealsEntered,
            "Conversão da anterior (%)":
              s.conversionFromPrevPct === null ? "" : s.conversionFromPrevPct,
            "Intervalos fechados": s.closedIntervals,
            "Mediana (dias)": num(s.medianDays),
            "P90 (dias)": num(s.p90Days),
            "Dentro do SLA (%)": s.withinSlaPct === null ? "" : s.withinSlaPct,
          }));
  }

  const csv = Papa.unparse(rows, { delimiter: ";" });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "REPORT_EXPORTED",
      result: "SUCCESS",
      resourceType: "pipeline_report",
      resource: ctx.orgId,
      metadata: { kind, periodo, tabela, incluirEstimados, rows: rows.length },
    }
  ).catch(() => {});

  const filename = `pipeline-${kind}-${tabela}-${periodo}.csv`;
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
