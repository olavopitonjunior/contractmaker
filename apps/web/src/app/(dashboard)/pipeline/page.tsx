import { requireFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { NovoNegocioDropdown } from "@/components/pipeline/NovoNegocioDropdown";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, DollarSign, BarChart3 } from "lucide-react";
import { getIListConnection } from "@/lib/ilist/connection";
import { getEffectivePermissions, dealScopeWhere } from "@/lib/security/rbac/check";
import { getBoardStages, getBoardKpis } from "@/lib/pipeline/board-query";
import { parseBoardFilters } from "@/lib/pipeline/list-filters";
import { getResponsavelOptions } from "@/lib/pipeline/responsaveis";
import { PipelineFilters } from "@/components/pipeline/PipelineFilters";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  // Gate de módulo: tenant sem vendas cai na landing por entitlement (homeHref).
  // NÃO usar layout aqui — /pipeline/locacao é filho deste segmento e precisa
  // continuar acessível pra quem só tem locação.
  const { userId, orgId } = await requireFeaturePage(FEATURE.VENDAS_PIPELINE);

  // Escopo por usuário (feature Gerente): visão restrita só vê deals onde é
  // gerente atribuído ou criador; demais roles seguem org-wide ({}).
  const eff = await getEffectivePermissions(userId, orgId);
  const dealScope = dealScopeWhere(eff) ?? { id: "__none__" };

  // Filtros server-side da URL (?q=&responsavel=&sla=&periodo=&canal=&arquivados=1)
  // — entram no WHERE da query do board (list-filters.ts).
  const filters = parseBoardFilters(searchParams);

  // iList (RE/MAX): entrada extra no dropdown só quando o tenant tem conexão
  // provisionada pelo super-admin (gating por existência — ver lib/ilist/connection.ts).
  const hasIList = (await getIListConnection(orgId)) !== null;

  // nowMs único pro render — cards, board e filtros de SLA derivam dele (#418).
  const nowMs = Date.now();

  // Board com cap de 200/stage + _count filtrado (board-query.ts). O where
  // interno já filtra kind="venda" no pipeline — mesmo footgun-guard do
  // getPipelineByKind.
  const board = await getBoardStages({
    orgId,
    kind: "venda",
    filters,
    extraWhere: dealScope,
    orderBy: { position: "asc" },
    nowMs,
  });

  if (!board) {
    return <p className="text-muted-foreground p-6">Pipeline não configurado.</p>;
  }

  // KPIs da ORG via aggregate — visão default (sem arquivados), independem
  // dos filtros da URL e do cap por coluna.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [kpis, responsaveis] = await Promise.all([
    getBoardKpis(
      { pipelineId: board.pipelineId, archivedAt: null, ...dealScope },
      startOfToday
    ),
    getResponsavelOptions({ orgId, pipelineId: board.pipelineId }),
  ]);

  const stageIdByName = new Map(board.stages.map((s) => [s.name, s.id]));
  const countFor = (name: string) =>
    kpis.byStageId[stageIdByName.get(name) ?? ""]?.count ?? 0;
  const concludedDeals = countFor("Comissão paga");
  const lostDeals = countFor("Negócio perdido");
  const activeDeals = kpis.totalDeals - concludedDeals - lostDeals;
  const totalValue = kpis.totalValue;
  const conversionRate =
    kpis.totalDeals > 0 ? Math.round((concludedDeals / kpis.totalDeals) * 100) : 0;
  const dealsToday = kpis.dealsToday;
  const ticketMedio = kpis.dealsWithValue > 0 ? totalValue / kpis.dealsWithValue : 0;
  const fmtBRLShort = (v: number) =>
    v >= 1_000_000
      ? `R$ ${(v / 1_000_000).toFixed(1)}M`
      : v >= 1000
        ? `R$ ${(v / 1000).toFixed(0)}k`
        : `R$ ${v.toFixed(0)}`;

  const stages = board.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color || "#6366f1",
    deals: stage.deals,
    total: stage.total,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Pipeline de Vendas
        </h1>
        <NovoNegocioDropdown hasIList={hasIList} />
      </div>

      {/* Metrics — KPI cards V1 (ícone em chip + número + microcopy).
          Largura controlada p/ não esticar: compactos e alinhados à esquerda. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:max-w-4xl">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">{activeDeals}</p>
              <p className="text-xs text-muted-foreground">
                Negócios ativos
                {dealsToday > 0 && (
                  <span className="ml-1.5 font-medium text-success">
                    +{dealsToday} hoje
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10">
              <DollarSign className="h-5 w-5 text-success" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">
                {fmtBRLShort(totalValue)}
              </p>
              <p className="text-xs text-muted-foreground">
                Valor em pipeline
                {ticketMedio > 0 && (
                  <span className="ml-1.5">
                    · Ticket médio {fmtBRLShort(ticketMedio)}
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-info/10">
              <TrendingUp className="h-5 w-5 text-info" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">{conversionRate}%</p>
              <p className="text-xs text-muted-foreground">
                Taxa de conversão
                {concludedDeals > 0 && (
                  <span className="ml-1.5">
                    · {concludedDeals}{" "}
                    {concludedDeals === 1 ? "fechamento" : "fechamentos"}
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros server-side — filtram a QUERY (cap 200/stage), não só os cards */}
      <PipelineFilters
        filters={filters}
        responsaveis={responsaveis}
        totals={board.totals}
      />

      {/* Kanban — nowMs serializado evita Date.now() no render do client (#418) */}
      <KanbanBoard stages={stages} nowMs={nowMs} hideToolbar />
    </div>
  );
}
