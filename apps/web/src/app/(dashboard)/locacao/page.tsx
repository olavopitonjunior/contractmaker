import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div className="h-2 rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  );
}
import {
  Wallet,
  AlertTriangle,
  ShieldCheck,
  ClipboardList,
  TrendingUp,
  Receipt,
  Calendar,
  Send,
  Bell,
} from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { competenciaFor } from "@/lib/locacao/rent-scheduler";
import { AIInsightsCard } from "@/components/ai-assist/InsightsCard";
import { SegmentedBar } from "@/components/locacao/SegmentedBar";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Dashboard operacional /locacao (docs/locacao/spec.md §17.5).
// Espelha o resumo do Superlógica §3 — cards por área de pendência.
// Lê direto do prisma (server component) — mesmo agregado do endpoint
// /api/locacao/dashboard, mas dispensa a chamada HTTP.

export default async function LocacaoDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const now = new Date();
  const competencia = competenciaFor(now);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const in60d = new Date(now.getTime() + 60 * 24 * 3600_000);

  const [
    cobrancasMonth,
    cobrancasPaid,
    cobrancasLate,
    checklistsPending,
    repassesToRealize,
    expensesOverdue,
    leasesActive,
    insuranceExpiring,
    repasseGarantidoActive,
    // Novos cards F2.1:
    garantiasMes,
    garantias60d,
    leasesSemGarantia,
    reajustesMes,
    leasesSemTaxa,
  ] = await Promise.all([
    prisma.rentCharge.count({ where: { orgId: org.id, competencia } }),
    prisma.rentCharge.count({ where: { orgId: org.id, competencia, status: "paga" } }),
    prisma.rentCharge.count({ where: { orgId: org.id, competencia, status: "atrasada" } }),
    prisma.checklist.count({
      where: { orgId: org.id, status: { in: ["pendente", "aguardando_aprovacao"] } },
    }),
    prisma.rentCharge.count({
      where: {
        orgId: org.id,
        status: "paga",
        repasseTransferId: null,
        paidAt: { gte: startOfMonth, lt: startOfNextMonth },
      },
    }),
    prisma.expense.count({
      where: { orgId: org.id, status: "pendente", dueDate: { lt: today } },
    }),
    prisma.leaseContract.findMany({
      where: { orgId: org.id, status: "ativo" },
      select: { valorAluguel: true, taxaAdminPercent: true },
    }),
    prisma.insurancePolicy.count({
      where: {
        orgId: org.id,
        status: "ativa",
        vigenciaFim: { lte: in60d, gte: now },
      },
    }),
    prisma.leaseContract.count({
      where: { orgId: org.id, status: "ativo", repasseGarantido: { not: "nao" } },
    }),
    // Garantias: ativas com leaseContract.vigenciaFim no mês corrente
    prisma.guarantee.count({
      where: {
        orgId: org.id,
        status: "ativa",
        leaseContract: { vigenciaFim: { gte: startOfMonth, lt: startOfNextMonth } },
      },
    }),
    // Garantias: ativas com leaseContract.vigenciaFim nos próximos 60d
    prisma.guarantee.count({
      where: {
        orgId: org.id,
        status: "ativa",
        leaseContract: { vigenciaFim: { lte: in60d, gte: now } },
      },
    }),
    // Contratos ativos sem garantia
    prisma.leaseContract.count({
      where: { orgId: org.id, status: "ativo", guarantee: null },
    }),
    // Reajustes do mês: dataProximoReajuste neste mês corrente
    prisma.leaseContract.count({
      where: {
        orgId: org.id,
        status: "ativo",
        dataProximoReajuste: { gte: startOfMonth, lt: startOfNextMonth },
      },
    }),
    // Contratos sem taxa de locação configurada
    prisma.leaseContract.count({
      where: { orgId: org.id, status: "ativo", taxaAdminPercent: { lte: 0 } },
    }),
  ]);

  const taxaAdmTotal = leasesActive.reduce(
    (acc, lc) => acc + (lc.valorAluguel * lc.taxaAdminPercent) / 100,
    0
  );
  const percentRecebido = cobrancasMonth > 0 ? (cobrancasPaid / cobrancasMonth) * 100 : 0;

  return (
    <div className="space-y-4">
      <AIInsightsCard context="dashboard" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> Cobranças do mês ({competencia})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <SegmentedBar
            height="h-3"
            segments={[
              { value: cobrancasPaid, color: "bg-emerald-500", label: "pagas" },
              {
                value: Math.max(0, cobrancasMonth - cobrancasPaid - cobrancasLate),
                color: "bg-amber-400",
                label: "a vencer",
              },
              { value: cobrancasLate, color: "bg-red-500", label: "atrasadas" },
            ]}
            showLegend
          />
          <div className="text-sm font-semibold">{percentRecebido.toFixed(1)}% recebido</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Taxa adm
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{fmtBRL(taxaAdmTotal)}</div>
          <div className="text-xs text-muted-foreground">
            {leasesActive.length} contratos ativos
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Seguros próx. 60d
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{insuranceExpiring}</div>
          <div className="text-xs text-muted-foreground">apólices a vencer</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" /> Checklists pendentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{checklistsPending}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4" /> Repasses a realizar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{repassesToRealize}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" /> Despesas atrasadas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold">{expensesOverdue}</span>
            {expensesOverdue > 0 ? (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 h-3 w-3" /> ação
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> Repasse garantido ativo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{repasseGarantidoActive}</div>
          <div className="text-xs text-muted-foreground">contratos com exposição</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Garantias vencendo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xl font-semibold">{garantiasMes}</div>
              <div className="text-[10px] uppercase text-muted-foreground">no mês</div>
            </div>
            <div>
              <div className="text-xl font-semibold">{garantias60d}</div>
              <div className="text-[10px] uppercase text-muted-foreground">60d</div>
            </div>
            <div>
              <div className="text-xl font-semibold">{leasesSemGarantia}</div>
              <div className="text-[10px] uppercase text-muted-foreground">sem</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Reajustes no mês
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{reajustesMes}</div>
          <div className="text-xs text-muted-foreground">
            {reajustesMes > 0 ? "contratos a reajustar" : "sem reajuste pendente"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" /> Contratos sem taxa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold">{leasesSemTaxa}</span>
            {leasesSemTaxa > 0 ? (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 h-3 w-3" /> revisar
              </Badge>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            taxaAdminPercent ≤ 0 (contrato sem fee)
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
