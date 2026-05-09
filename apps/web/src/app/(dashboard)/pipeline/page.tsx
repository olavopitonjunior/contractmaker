import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
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
} from "lucide-react";

export default async function PipelinePage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-muted-foreground">
          Nenhuma organizacao encontrada.
        </p>
      </div>
    );
  }

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id },
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            orderBy: { position: "asc" },
            include: {
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
                where: { isLatest: true },
                select: { id: true, version: true },
              },
              envelopes: {
                where: { source: "contract", status: "closed" },
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

  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color || "#6366f1",
    deals: stage.deals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      value: deal.value,
      createdAt: deal.createdAt.toISOString(),
      formStatus: deal.form?.status || null,
      formToken: deal.form?.token || null,
      hasContract: deal.contracts.length > 0,
      formOpenedAt: deal.form?.createdAt?.toISOString() ?? null,
      formCompletedAt: deal.form?.completedAt?.toISOString() ?? null,
      contractSignedAt: deal.envelopes[0]?.closedAt?.toISOString() ?? null,
      chargeCreatedAt: deal.commissionCharges[0]?.createdAt.toISOString() ?? null,
      commissionPaidAt: deal.commissionPaidAt?.toISOString() ?? null,
      lostAt: deal.lostAt?.toISOString() ?? null,
      lostReason: deal.lostReason ?? null,
    })),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pipeline de Vendas</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
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

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeDeals}</p>
              <p className="text-xs text-muted-foreground">Negócios ativos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
              <DollarSign className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {totalValue >= 1_000_000
                  ? `R$ ${(totalValue / 1_000_000).toFixed(1)}M`
                  : `R$ ${(totalValue / 1000).toFixed(0)}k`}
              </p>
              <p className="text-xs text-muted-foreground">Valor total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{conversionRate}%</p>
              <p className="text-xs text-muted-foreground">Taxa de conversão</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Kanban */}
      <KanbanBoard stages={stages} />
    </div>
  );
}
