import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, TrendingUp, TrendingDown, Calendar, AlertTriangle } from "lucide-react";
import { ContratosTable, type ContratoRow } from "@/components/locacao/ContratosTable";

export const dynamic = "force-dynamic";

interface ResumoCard {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "destructive" | "warning";
}

export default async function LocacaoContratosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [contracts, conquistadosMes, rescindidosMes, aReajustar, semTaxa] = await Promise.all([
    prisma.leaseContract.findMany({
      where: { orgId: org.id },
      include: {
        property: { select: { rua: true, numero: true, cidade: true, uf: true } },
        tenants: { include: { tenant: { select: { nome: true } } } },
        _count: { select: { rentCharges: true, expenses: true, checklists: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    prisma.leaseContract.count({
      where: {
        orgId: org.id,
        status: "ativo",
        vigenciaInicio: { gte: startOfMonth, lt: startOfNextMonth },
      },
    }),
    prisma.leaseContract.count({
      where: {
        orgId: org.id,
        status: { in: ["rescisao", "encerrado"] },
        updatedAt: { gte: startOfMonth, lt: startOfNextMonth },
      },
    }),
    prisma.leaseContract.count({
      where: {
        orgId: org.id,
        status: "ativo",
        dataProximoReajuste: { gte: startOfMonth, lt: startOfNextMonth },
      },
    }),
    prisma.leaseContract.count({
      where: { orgId: org.id, status: "ativo", taxaAdminPercent: { lte: 0 } },
    }),
  ]);

  const ativos = contracts.filter((c) => c.status === "ativo").length;
  const rescisao = contracts.filter((c) => c.status === "rescisao").length;
  const renovacao = contracts.filter((c) => c.status === "renovacao").length;

  const resumo: ResumoCard[] = [
    { label: "Conquistados no mês", value: conquistadosMes, icon: TrendingUp },
    { label: "Rescindidos no mês", value: rescindidosMes, icon: TrendingDown, tone: "destructive" },
    { label: "A reajustar", value: aReajustar, icon: Calendar },
    { label: "Sem taxa de locação", value: semTaxa, icon: AlertTriangle, tone: "warning" },
  ];

  const rows: ContratoRow[] = contracts.map((lc) => ({
    id: lc.id,
    vencimento: lc.vigenciaFim ? lc.vigenciaFim.toISOString() : null,
    diaVencimento: lc.diaVencimento,
    endereco: lc.property
      ? [
          [lc.property.rua, lc.property.numero].filter(Boolean).join(", "),
          [lc.property.cidade, lc.property.uf].filter(Boolean).join("/"),
        ]
          .filter(Boolean)
          .join(" · ")
      : "—",
    inquilinos: lc.tenants.map((t) => t.tenant.nome).join(", ") || "sem inquilinos",
    aluguel: lc.valorAluguel,
    taxaAdm: lc.taxaAdminPercent,
    cobrancasCount: lc._count.rentCharges,
    despesasCount: lc._count.expenses,
    status: lc.status,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Contratos de Locação</h2>
        <p className="text-sm text-muted-foreground">
          {contracts.length} no total · {ativos} ativos · {renovacao} em renovação · {rescisao} em rescisão.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {resumo.map((card) => {
          const Icon = card.icon;
          const accent =
            card.tone === "destructive"
              ? "text-destructive"
              : card.tone === "warning"
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground";
          return (
            <Card key={card.label}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className={`text-2xl font-semibold ${accent}`}>{card.value}</div>
                  <div className="text-xs text-muted-foreground">{card.label}</div>
                </div>
                <Icon className={`h-5 w-5 ${accent} opacity-70`} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ContratosTable
        data={rows}
        emptyState={{
          icon: <FileText className="h-10 w-10" />,
          title: "Nenhum contrato",
          description:
            'Contratos são criados ao mover um deal pra "Chaves Entregues" na Esteira.',
        }}
      />
    </div>
  );
}
