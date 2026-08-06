import { requireFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import {
  Plus,
  TrendingUp,
  DollarSign,
  BarChart3,
  FileText,
  Upload,
  Sparkles,
  Building2,
} from "lucide-react";
import { getIListConnection } from "@/lib/ilist/connection";
import { getEffectivePermissions, dealScopeWhere } from "@/lib/security/rbac/check";
import { prisma } from "@/lib/db/prisma";
import { getBoardStages, getBoardKpis } from "@/lib/pipeline/board-query";
import { parseBoardFilters } from "@/lib/pipeline/list-filters";
import { PipelineFilters } from "@/components/pipeline/PipelineFilters";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  // Gate de módulo: tenant só-locação (vendas OFF) é redirecionado pra /locacao.
  // NÃO usar layout aqui — /pipeline/locacao é filho deste segmento e precisa
  // continuar acessível pra quem só tem locação.
  const { userId, orgId } = await requireFeaturePage(FEATURE.VENDAS_PIPELINE, "/locacao");

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
  const [kpis, responsaveisRaw] = await Promise.all([
    getBoardKpis(
      { pipelineId: board.pipelineId, archivedAt: null, ...dealScope },
      startOfToday
    ),
    prisma.user.findMany({
      where: { deals: { some: { pipelineId: board.pipelineId } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const responsaveis = responsaveisRaw.map((u) => ({
    id: u.id,
    label: u.name?.trim() || u.email || u.id,
  }));

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className={
                searchParams?.novo === "1"
                  ? "ring-2 ring-brand-accent ring-offset-2 animate-pulse"
                  : undefined
              }
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Novo negócio
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem asChild>
              <Link href="/forms/new" className="flex items-start gap-3 py-2">
                <FileText className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">Novo formulário (link público)</span>
                  <span className="text-xs text-muted-foreground">
                    Envia link para o cliente preencher os 7 passos. Contrato é
                    gerado pelo template padrão.
                  </span>
                </div>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/deals/new-from-proposal"
                className="flex items-start gap-3 py-2"
              >
                <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">Cadastro com proposta</span>
                  <span className="text-xs text-muted-foreground">
                    Sobe uma proposta (PDF/DOCX). Sistema lê tudo (partes,
                    valores, comissão) e abre o formulário pré-preenchido pra
                    revisar antes de gerar o contrato.
                  </span>
                </div>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/deals/new-from-upload"
                className="flex items-start gap-3 py-2"
              >
                <Upload className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">Cadastro rápido com upload</span>
                  <span className="text-xs text-muted-foreground">
                    Sobe um CCV (PDF/DOCX) pronto. Sistema lê os dados e abre o
                    contrato no editor pra revisar e enviar pra assinatura.
                  </span>
                </div>
              </Link>
            </DropdownMenuItem>
            {hasIList && (
              <DropdownMenuItem asChild>
                <Link
                  href="/deals/new-from-ilist"
                  className="flex items-start gap-3 py-2"
                >
                  <Building2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">Novo contrato do iList</span>
                    <span className="text-xs text-muted-foreground">
                      Busca o imóvel no catálogo RE/MAX e abre o formulário com
                      imóvel e comissão pré-preenchidos.
                    </span>
                  </div>
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
