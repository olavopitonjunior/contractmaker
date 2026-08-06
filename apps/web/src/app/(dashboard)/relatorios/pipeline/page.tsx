import Link from "next/link";
import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, TriangleAlert } from "lucide-react";
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { prisma } from "@/lib/db/prisma";
import { getPipelineReport } from "@/lib/pipeline/reports";
import { getFunnelByChannel } from "@/lib/pipeline/funnel";
import { slaStatusFrom } from "@/lib/pipeline/sla";
import { PipelineReportCharts } from "@/components/relatorios/PipelineReportCharts";

export const dynamic = "force-dynamic";

/**
 * /relatorios/pipeline (plano 2026-08-06, PR 3.7) — o painel do funil:
 * tempos por etapa (mediana/p90 do DealStageHistory), % dentro do SLA
 * congelado, passagem/conversão por etapa, ciclo até ganho, por corretor e
 * por canal (o /relatorios/funil vira a aba Canais). Estimados ficam FORA
 * das métricas de tempo por default (?incluirEstimados=1 liga, com banner).
 */

const PERIODS: Array<{ key: string; label: string; days: number | null }> = [
  { key: "30d", label: "30 dias", days: 30 },
  { key: "90d", label: "90 dias", days: 90 },
  { key: "12m", label: "12 meses", days: 365 },
  { key: "all", label: "Tudo", days: null },
];

const ABAS = [
  { key: "visao", label: "Visão geral" },
  { key: "corretores", label: "Por corretor" },
  { key: "canais", label: "Por canal" },
  { key: "negocios", label: "Negócios" },
] as const;
type Aba = (typeof ABAS)[number]["key"];

const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

function fmtDays(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("pt-BR")}d`;
}

export default async function PipelineReportPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { userId, orgId, enabled } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PIPELINE,
    FEATURE.LOCACAO_PIPELINE,
  ]);
  const hasVendas = enabled[FEATURE.VENDAS_PIPELINE] === true;
  const hasLocacao = enabled[FEATURE.LOCACAO_PIPELINE] === true;

  // RBAC: relatório expõe números da operação inteira — exige REPORT_VIEW
  // (mesma permissão dos relatórios financeiros/DIMOB).
  const eff = await getEffectivePermissions(userId, orgId);
  if (!can(eff, PERMISSION.REPORT_VIEW)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Relatório do pipeline" description="" />
        <p className="text-sm text-muted-foreground">
          Você não tem a permissão &ldquo;Ver relatórios&rdquo;. Peça a um
          administrador da organização.
        </p>
      </div>
    );
  }
  const canExport = can(eff, PERMISSION.REPORT_EXPORT);

  const sp = (k: string) => {
    const v = searchParams?.[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const period = PERIODS.find((p) => p.key === sp("periodo")) ?? PERIODS[1];
  const wantsLocacao = sp("kind") === "locacao";
  const kind =
    (wantsLocacao && hasLocacao) || (!hasVendas && hasLocacao)
      ? ("locacao" as const)
      : ("venda" as const);
  const aba: Aba = (ABAS.find((a) => a.key === sp("aba"))?.key ?? "visao") as Aba;
  const incluirEstimados = sp("incluirEstimados") === "1";
  const nowMs = Date.now();
  const from = period.days ? new Date(nowMs - period.days * 86_400_000) : undefined;

  const report = await getPipelineReport({
    orgId,
    kind,
    from,
    incluirEstimados,
  });
  const channelRows =
    aba === "canais" ? await getFunnelByChannel({ orgId, kind, from }) : [];
  const drilldown =
    aba === "negocios"
      ? await prisma.deal.findMany({
          where: {
            pipeline: { orgId, kind },
            kind: kind === "locacao" ? "locacao" : undefined,
            archivedAt: null,
            ...(from ? { createdAt: { gte: from } } : {}),
          },
          orderBy: [{ slaDueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
          take: 50,
          select: {
            id: true,
            title: true,
            value: true,
            createdAt: true,
            stageEnteredAt: true,
            slaWarnAt: true,
            slaDueAt: true,
            lostAt: true,
            stage: { select: { name: true } },
            user: { select: { name: true, email: true } },
          },
        })
      : [];

  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams({
      periodo: period.key,
      kind,
      aba,
      ...(incluirEstimados ? { incluirEstimados: "1" } : {}),
    });
    for (const [k, v] of Object.entries(over)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    return `/relatorios/pipeline?${p.toString()}`;
  };

  const dealPathBase = kind === "locacao" ? "/locacao/deals" : "/deals";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Relatório do pipeline"
          description="Tempo por etapa, cumprimento de SLA, conversão do funil, ciclo até o ganho e produtividade por corretor."
        />
        {canExport && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`/api/relatorios/pipeline/export?kind=${kind}&periodo=${period.key}${incluirEstimados ? "&incluirEstimados=1" : ""}&tabela=${aba === "corretores" ? "corretores" : aba === "canais" ? "canais" : "etapas"}`}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Exportar CSV
            </a>
          </Button>
        )}
      </div>

      {/* Filtros: esteira + período + abas (links server-side) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border overflow-hidden">
          {(["venda", "locacao"] as const)
            .filter((k) => (k === "venda" ? hasVendas : hasLocacao))
            .map((k) => (
              <Link
                key={k}
                href={qs({ kind: k })}
                className={`px-3 py-1.5 text-sm ${
                  kind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                {k === "venda" ? "Vendas" : "Locação"}
              </Link>
            ))}
        </div>
        <div className="flex rounded-md border overflow-hidden">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={qs({ periodo: p.key })}
              className={`px-3 py-1.5 text-sm ${
                period.key === p.key
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <Link
          href={qs({ incluirEstimados: incluirEstimados ? null : "1" })}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            incluirEstimados ? "bg-secondary" : "hover:bg-muted"
          }`}
        >
          Incluir estimados
        </Link>
      </div>

      {incluirEstimados ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          Métricas de tempo incluem intervalos ESTIMADOS (backfill do histórico
          — duração aproximada). Use pra visão geral, não pra cobrança de SLA.
        </div>
      ) : report.estimatedExcluded > 0 ? (
        <p className="text-xs text-muted-foreground">
          {report.estimatedExcluded} intervalo(s) estimado(s) (backfill) fora
          das métricas de tempo.{" "}
          <Link href={qs({ incluirEstimados: "1" })} className="underline">
            Incluir
          </Link>
        </p>
      ) : null}

      {/* Abas */}
      <div className="flex rounded-md border overflow-hidden w-fit">
        {ABAS.map((a) => (
          <Link
            key={a.key}
            href={qs({ aba: a.key })}
            className={`px-3 py-1.5 text-sm ${
              aba === a.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {a.label}
          </Link>
        ))}
      </div>

      {aba === "visao" && (
        <>
          <div className="grid gap-4 sm:grid-cols-3 sm:max-w-3xl">
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold tabular-nums">{report.cycle.wonDeals}</p>
                <p className="text-xs text-muted-foreground">
                  {kind === "venda" ? "Negócios ganhos" : "Contratos em ADM"} no período
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold tabular-nums">
                  {fmtDays(report.cycle.medianDays)}
                </p>
                <p className="text-xs text-muted-foreground">Ciclo mediano até o ganho</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold tabular-nums">
                  {fmtDays(report.cycle.p90Days)}
                </p>
                <p className="text-xs text-muted-foreground">Ciclo P90 até o ganho</p>
              </CardContent>
            </Card>
          </div>

          <PipelineReportCharts
            rows={report.stages.map((s) => ({
              stageName: s.stageName,
              medianDays: s.medianDays,
              p90Days: s.p90Days,
              dealsEntered: s.dealsEntered,
            }))}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Etapas do funil</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs">
                    <tr>
                      <th className="text-left p-2">Etapa</th>
                      <th className="text-right p-2">Passaram</th>
                      <th className="text-right p-2">Conversão da anterior</th>
                      <th className="text-right p-2">Intervalos fechados</th>
                      <th className="text-right p-2">Mediana</th>
                      <th className="text-right p-2">P90</th>
                      <th className="text-right p-2">Dentro do SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.stages.map((s) => (
                      <tr key={s.stageName} className="border-t">
                        <td className="p-2 font-medium">{s.stageName}</td>
                        <td className="text-right p-2 tabular-nums">{s.dealsEntered}</td>
                        <td className="text-right p-2 tabular-nums">
                          {s.conversionFromPrevPct === null
                            ? "—"
                            : `${s.conversionFromPrevPct}%`}
                        </td>
                        <td className="text-right p-2 tabular-nums">
                          {s.closedIntervals}
                        </td>
                        <td className="text-right p-2 tabular-nums">
                          {fmtDays(s.medianDays)}
                        </td>
                        <td className="text-right p-2 tabular-nums">
                          {fmtDays(s.p90Days)}
                        </td>
                        <td className="text-right p-2 tabular-nums">
                          {s.withinSlaPct === null ? (
                            "—"
                          ) : (
                            <Badge
                              variant="outline"
                              className={
                                s.withinSlaPct >= 80
                                  ? "border-green-500 text-green-700"
                                  : s.withinSlaPct >= 50
                                    ? "border-amber-500 text-amber-700"
                                    : "border-red-500 text-red-700"
                              }
                            >
                              {s.withinSlaPct}%
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                    {report.stages.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-muted-foreground">
                          Sem histórico de etapas no período. O histórico começa
                          a acumular com o uso (e com o backfill).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {aba === "corretores" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por corretor (responsável)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="text-left p-2">Responsável</th>
                    <th className="text-right p-2">Criados</th>
                    <th className="text-right p-2">{kind === "venda" ? "Ganhos" : "Em ADM"}</th>
                    <th className="text-right p-2">Perdidos</th>
                    <th className="text-right p-2">Conversão</th>
                    <th className="text-right p-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byBroker.map((r) => (
                    <tr key={r.userId} className="border-t">
                      <td className="p-2 font-medium">{r.label}</td>
                      <td className="text-right p-2 tabular-nums">{r.total}</td>
                      <td className="text-right p-2 tabular-nums text-green-700">{r.won}</td>
                      <td className="text-right p-2 tabular-nums text-red-700">{r.lost}</td>
                      <td className="text-right p-2 tabular-nums">{r.conversionPct}%</td>
                      <td className="text-right p-2 tabular-nums">
                        {brlCompact.format(r.totalValue)}
                      </td>
                    </tr>
                  ))}
                  {report.byBroker.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground">
                        Nenhum negócio no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {aba === "canais" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por canal de origem</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="text-left p-2">Canal</th>
                    <th className="text-right p-2">Criados</th>
                    <th className="text-right p-2">{kind === "venda" ? "Ganhos" : "Em ADM"}</th>
                    <th className="text-right p-2">Perdidos</th>
                    <th className="text-right p-2">Conversão</th>
                    <th className="text-right p-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.map((r) => (
                    <tr key={r.channel ?? "__null"} className="border-t">
                      <td className="p-2 font-medium">{r.label}</td>
                      <td className="text-right p-2 tabular-nums">{r.total}</td>
                      <td className="text-right p-2 tabular-nums text-green-700">{r.won}</td>
                      <td className="text-right p-2 tabular-nums text-red-700">{r.lost}</td>
                      <td className="text-right p-2 tabular-nums">{r.conversionPct}%</td>
                      <td className="text-right p-2 tabular-nums">
                        {brlCompact.format(r.totalValue)}
                      </td>
                    </tr>
                  ))}
                  {channelRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground">
                        Nenhum negócio no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">
              Visão detalhada por canal também em{" "}
              <Link href="/relatorios/funil" className="underline">
                Origem dos negócios
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {aba === "negocios" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Negócios do período (50 mais urgentes por SLA)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="text-left p-2">Negócio</th>
                    <th className="text-left p-2">Etapa</th>
                    <th className="text-left p-2">Responsável</th>
                    <th className="text-right p-2">Dias na etapa</th>
                    <th className="text-right p-2">SLA</th>
                    <th className="text-right p-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.map((d) => {
                    const days = Math.floor(
                      (nowMs -
                        (d.stageEnteredAt ?? d.createdAt).getTime()) /
                        86_400_000
                    );
                    const status = d.lostAt ? null : slaStatusFrom(d, nowMs);
                    return (
                      <tr key={d.id} className="border-t">
                        <td className="p-2">
                          <Link
                            href={`${dealPathBase}/${d.id}`}
                            className="font-medium hover:underline"
                          >
                            {d.title}
                          </Link>
                        </td>
                        <td className="p-2">{d.lostAt ? "Perdido" : d.stage?.name ?? "—"}</td>
                        <td className="p-2">
                          {d.user?.name?.trim() || d.user?.email || "—"}
                        </td>
                        <td className="text-right p-2 tabular-nums">{days}</td>
                        <td className="text-right p-2">
                          {status === null ? (
                            "—"
                          ) : (
                            <Badge
                              variant="outline"
                              className={
                                status === "atrasado"
                                  ? "border-red-500 text-red-700"
                                  : status === "atencao"
                                    ? "border-amber-500 text-amber-700"
                                    : "border-green-500 text-green-700"
                              }
                            >
                              {status === "atrasado"
                                ? "Atrasado"
                                : status === "atencao"
                                  ? "Atenção"
                                  : "Em dia"}
                            </Badge>
                          )}
                        </td>
                        <td className="text-right p-2 tabular-nums">
                          {d.value ? brlCompact.format(d.value) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {drilldown.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground">
                        Nenhum negócio no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
