import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Plus, ClipboardList, TrendingUp, DollarSign, BarChart3 } from "lucide-react";

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
              form: { select: { id: true, status: true } },
              contracts: {
                where: { isLatest: true },
                select: { id: true, version: true },
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
  const totalDeals = allDeals.length;
  const totalValue = allDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const wonStage = pipeline.stages.find((s) => s.name === "Fechado Ganho");
  const wonDeals = wonStage?.deals.length || 0;
  const conversionRate = totalDeals > 0 ? Math.round((wonDeals / totalDeals) * 100) : 0;

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
      hasContract: deal.contracts.length > 0,
    })),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pipeline de Vendas</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/forms">
              <ClipboardList className="mr-1.5 h-4 w-4" />
              Formularios
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/forms/new">
              <Plus className="mr-1.5 h-4 w-4" />
              Novo Formulario
            </Link>
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalDeals}</p>
              <p className="text-xs text-muted-foreground">Negocios ativos</p>
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
                R$ {(totalValue / 1000).toFixed(0)}k
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
              <p className="text-xs text-muted-foreground">Taxa conversao</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Kanban */}
      <KanbanBoard stages={stages} />
    </div>
  );
}
