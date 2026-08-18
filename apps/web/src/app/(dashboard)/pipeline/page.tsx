import { requireFeaturePage } from "@/lib/modules/page-guard";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { FEATURE, MODULE } from "@/lib/modules/catalog";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { NovoNegocioDropdown } from "@/components/pipeline/NovoNegocioDropdown";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, DollarSign, BarChart3 } from "lucide-react";
import { getIListConnection } from "@/lib/ilist/connection";
import { getEffectivePermissions, dealScopeWhere } from "@/lib/security/rbac/check";
import { DEAL_CARD_INCLUDE, toDealCard } from "@/lib/pipeline/deal-dates";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { arquivados?: string; novo?: string };
}) {
  // Gate de módulo: tenant só-locação (vendas OFF) é redirecionado pra /locacao.
  // NÃO usar layout aqui — /pipeline/locacao é filho deste segmento e precisa
  // continuar acessível pra quem só tem locação.
  const { userId, orgId } = await requireFeaturePage(FEATURE.VENDAS_PIPELINE, "/locacao");

  // Escopo por usuário (feature Gerente): visão restrita só vê deals onde é
  // gerente atribuído ou criador; demais roles seguem org-wide ({}).
  const eff = await getEffectivePermissions(userId, orgId);
  const dealScope = dealScopeWhere(eff) ?? { id: "__none__" };

  // ?arquivados=1 mostra também os deals arquivados (recuperação). Default oculta.
  const includeArchived = searchParams?.arquivados === "1";

  // iList (RE/MAX): entrada extra no dropdown só quando o tenant tem conexão
  // provisionada pelo super-admin (gating por existência — ver lib/ilist/connection.ts).
  const hasIList = (await getIListConnection(orgId)) !== null;

  // Filtra SEMPRE por kind="venda" (getPipelineByKind) — evita o footgun de
  // findFirst({ orgId }) sem kind, que pegaria o pipeline de locação.
  const pipeline = await getPipelineByKind(orgId, MODULE.VENDAS, {
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            where: {
              ...(includeArchived ? {} : { archivedAt: null }),
              ...dealScope,
            },
            orderBy: { position: "asc" },
            include: DEAL_CARD_INCLUDE,
          },
        },
      },
    },
  });

  if (!pipeline) {
    return <p className="text-muted-foreground p-6">Pipeline não configurado.</p>;
  }

  const allDeals = pipeline.stages.flatMap((s) => s.deals);
  const concludedStage = pipeline.stages.find((s) => s.name === "Comissão paga");
  const concludedDeals = concludedStage?.deals.length || 0;
  const lostStage = pipeline.stages.find((s) => s.name === "Negócio perdido");
  const lostDeals = lostStage?.deals.length || 0;
  const activeDeals = allDeals.length - concludedDeals - lostDeals;
  const totalValue = allDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const conversionRate =
    allDeals.length > 0 ? Math.round((concludedDeals / allDeals.length) * 100) : 0;

  // Microcopy V1: deltas e médias derivados (sem query extra)
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dealsToday = allDeals.filter(
    (d) => d.createdAt.getTime() >= startOfToday.getTime()
  ).length;
  const dealsWithValue = allDeals.filter((d) => (d.value || 0) > 0).length;
  const ticketMedio = dealsWithValue > 0 ? totalValue / dealsWithValue : 0;
  const fmtBRLShort = (v: number) =>
    v >= 1_000_000
      ? `R$ ${(v / 1_000_000).toFixed(1)}M`
      : v >= 1000
        ? `R$ ${(v / 1000).toFixed(0)}k`
        : `R$ ${v.toFixed(0)}`;

  // nowMs único pro render — cards e board derivam rótulos/SLA dele (#418).
  const nowMs = Date.now();
  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color || "#6366f1",
    deals: stage.deals.map((deal) => toDealCard(deal, nowMs, stage.name)),
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

      {/* Kanban — nowMs serializado evita Date.now() no render do client (#418) */}
      <KanbanBoard stages={stages} nowMs={nowMs} />
    </div>
  );
}
