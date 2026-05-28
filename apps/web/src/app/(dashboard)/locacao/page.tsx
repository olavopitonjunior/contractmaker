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
        vigenciaFim: { lte: new Date(now.getTime() + 60 * 24 * 3600_000), gte: now },
      },
    }),
    prisma.leaseContract.count({
      where: { orgId: org.id, status: "ativo", repasseGarantido: { not: "nao" } },
    }),
  ]);

  const taxaAdmTotal = leasesActive.reduce(
    (acc, lc) => acc + (lc.valorAluguel * lc.taxaAdminPercent) / 100,
    0
  );
  const percentRecebido = cobrancasMonth > 0 ? (cobrancasPaid / cobrancasMonth) * 100 : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> Cobranças do mês ({competencia})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <ProgressBar value={percentRecebido} />
          <div className="text-xs text-muted-foreground">
            {cobrancasPaid} pagas · {cobrancasMonth - cobrancasPaid - cobrancasLate} a vencer · {cobrancasLate} atrasadas
          </div>
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

      <Card className="md:col-span-2 xl:col-span-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" /> Próximos passos
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Esta é a Fase 1 do workspace de Locação. Cada cartão acima virará uma rota
          contextual com listagem detalhada e ações em lote — em sincronia com o
          spec de design (PR #48).
        </CardContent>
      </Card>
    </div>
  );
}
