import { requireFeaturePage } from "@/lib/modules/page-guard";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { FEATURE, MODULE } from "@/lib/modules/catalog";
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
} from "lucide-react";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { arquivados?: string; novo?: string };
}) {
  // Gate de módulo: tenant só-locação (vendas OFF) é redirecionado pra /locacao.
  // NÃO usar layout aqui — /pipeline/locacao é filho deste segmento e precisa
  // continuar acessível pra quem só tem locação.
  const { orgId } = await requireFeaturePage(FEATURE.VENDAS_PIPELINE, "/locacao");

  // ?arquivados=1 mostra também os deals arquivados (recuperação). Default oculta.
  const includeArchived = searchParams?.arquivados === "1";

  // Filtra SEMPRE por kind="venda" (getPipelineByKind) — evita o footgun de
  // findFirst({ orgId }) sem kind, que pegaria o pipeline de locação.
  const pipeline = await getPipelineByKind(orgId, MODULE.VENDAS, {
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            where: includeArchived ? undefined : { archivedAt: null },
            orderBy: { position: "asc" },
            include: {
              // NÃO selecionar form.dataJson aqui: é o payload inteiro do
              // formulário por deal só pra derivar um nome — o nome vive
              // denormalizado em Deal.clientName (backfill + write-points).
              form: {
                select: {
                  id: true,
                  status: true,
                  token: true,
                  createdAt: true,
                  completedAt: true,
                },
              },
              contracts: {
                where: { isLatest: true, kind: "contract" },
                select: { id: true, version: true },
              },
              envelopes: {
                where: { source: "contract", status: "closed", contract: { kind: "contract" } },
                select: { closedAt: true },
                orderBy: { closedAt: "desc" },
                take: 1,
              },
              commissionCharges: {
                select: { createdAt: true },
                orderBy: { createdAt: "asc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!pipeline) {
    return <p className="text-muted-foreground p-6">Pipeline nao configurado.</p>;
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

  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color || "#6366f1",
    deals: stage.deals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      value: deal.value,
      createdAt: deal.createdAt.toISOString(),
      clientName: deal.clientName,
      formStatus: deal.form?.status || null,
      formToken: deal.form?.token || null,
      hasContract: deal.contracts.length > 0,
      formOpenedAt: deal.form?.createdAt?.toISOString() ?? null,
      formCompletedAt: deal.form?.completedAt?.toISOString() ?? null,
      contractSignedAt:
        deal.envelopes[0]?.closedAt?.toISOString() ??
        deal.contractSignedAt?.toISOString() ??
        null,
      chargeCreatedAt:
        deal.commissionCharges[0]?.createdAt.toISOString() ??
        deal.chargeIssuedAt?.toISOString() ??
        null,
      commissionPaidAt: deal.commissionPaidAt?.toISOString() ?? null,
      lostAt: deal.lostAt?.toISOString() ?? null,
      lostReason: deal.lostReason ?? null,
      stageEnteredAt: deal.stageEnteredAt?.toISOString() ?? null,
    })),
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

      {/* Kanban */}
      <KanbanBoard stages={stages} />
    </div>
  );
}
