import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  TrendingUp,
  AlertCircle,
  FileText,
  Users,
  ArrowUpRight,
  Receipt,
  Send,
  GitMerge,
  BarChart3,
} from "lucide-react";
import {
  listAccessibleAccounts,
  resolveAsaasAccount,
  maskWalletId,
} from "@/lib/asaas/account";
import { AccountSwitcher } from "@/components/financeiro/AccountSwitcher";
import { getEffectiveUserId } from "@/lib/auth/impersonation";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams?: Promise<{ accountId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  // Impersonation: sob "trocar de tenant", quem resolve membership/RBAC é o dono
  // do tenant, não o super_admin (ver lib/auth/impersonation.ts).
  const effUserId = await getEffectiveUserId(session.user.id);

  const sp = (await searchParams) ?? {};
  const accessible = await listAccessibleAccounts(effUserId, org.id);

  // Sem nenhuma conta acessível APPROVED: mostra CTA bootstrap.
  const hasApproved = accessible.some((a) => a.status === "APPROVED");
  if (!hasApproved) {
    const firstNonApproved = accessible[0] ?? null;
    return (
      <div className="max-w-2xl mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              {accessible.length === 0
                ? "Configure sua conta Asaas"
                : "Aguardando aprovação"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {accessible.length === 0
                ? "Para usar o módulo financeiro, abra uma subconta Asaas e passe pela aprovação KYC. O processo é digital e leva ~2 minutos."
                : "Sua conta ainda está em análise. Você receberá um email assim que for aprovada."}
            </p>
            {firstNonApproved && (
              <p className="text-sm">
                Status atual:{" "}
                <Badge variant="outline">{firstNonApproved.status}</Badge>
              </p>
            )}
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/financeiro/onboarding">
                  {accessible.length === 0 ? "Começar agora" : "Continuar onboarding"}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/settings/pagamentos/contas">Gerenciar contas</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Resolve a conta em foco — hint vence se válido + acessível com cap "view".
  const resolved = await resolveAsaasAccount({
    userId: effUserId,
    orgId: org.id,
    hintAccountId: sp.accountId ?? null,
    requireCapability: "view",
  });
  if (!resolved) {
    redirect("/financeiro");
  }
  const account = resolved.account;

  // Aggregate KPIs
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const next30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Top categorias avulsas (últimos 90d) — só relevante quando org já usa avulsas
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const accountFilter = { orgId: org.id, accountId: account.id };
  const [receivedThisMonth, pendingNext30, overdue, recent, topCategoriesRaw] = await Promise.all([
    prisma.commissionCharge.aggregate({
      where: {
        ...accountFilter,
        status: { in: ["RECEIVED", "CONFIRMED"] },
        paidAt: { gte: firstOfMonth },
      },
      _sum: { value: true },
      _count: true,
    }),
    prisma.commissionCharge.aggregate({
      where: {
        ...accountFilter,
        status: "PENDING",
        currentDueDate: { gte: now, lte: next30 },
      },
      _sum: { value: true },
      _count: true,
    }),
    prisma.commissionCharge.aggregate({
      where: {
        ...accountFilter,
        status: "OVERDUE",
      },
      _sum: { value: true },
      _count: true,
    }),
    prisma.commissionCharge.findMany({
      where: accountFilter,
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        customer: { select: { name: true } },
        deal: { select: { id: true, title: true } },
      },
    }),
    prisma.commissionCharge.groupBy({
      by: ["categoryLabel"],
      where: {
        ...accountFilter,
        kind: { not: "commission" },
        categoryLabel: { not: null },
        createdAt: { gte: ninetyDaysAgo },
      },
      _count: true,
      _sum: { value: true },
      orderBy: { _count: { categoryLabel: "desc" } },
      take: 5,
    }),
  ]);

  const topCategories = topCategoriesRaw
    .map((r) => ({
      label: r.categoryLabel ?? "—",
      count: r._count,
      total: r._sum.value ?? 0,
    }))
    .filter((c) => c.label !== "—");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Wallet className="h-6 w-6" />
              Financeiro
            </h1>
            <p className="text-sm text-muted-foreground">
              {account.label ? `${account.label} · ` : ""}
              walletId <code className="text-xs">{maskWalletId(account.walletId)}</code>
            </p>
          </div>
          <AccountSwitcher
            currentAccountId={account.id}
            accounts={accessible
              .filter((a) => a.status === "APPROVED")
              .map((a) => ({
                id: a.id,
                label: a.label ?? `Conta ${a.id.slice(0, 6)}`,
                walletIdMasked: maskWalletId(a.walletId),
                isActive: a.id === account.id,
              }))}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" asChild>
            <Link href="/financeiro/cobrancas">
              <Receipt className="h-4 w-4 mr-1" /> Cobranças
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/financeiro/clientes">
              <Users className="h-4 w-4 mr-1" /> Clientes
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/financeiro/extrato">
              <FileText className="h-4 w-4 mr-1" /> Extrato
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/financeiro/transferencias">
              <Send className="h-4 w-4 mr-1" /> Transferir
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/financeiro/conciliacao">
              <GitMerge className="h-4 w-4 mr-1" /> Conciliação
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/financeiro/relatorios">
              <BarChart3 className="h-4 w-4 mr-1" /> Relatórios
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/financeiro/cobrancas/nova">
              <ArrowUpRight className="h-4 w-4 mr-1" /> Nova cobrança
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Recebido este mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-green-700">
              {fmtBRL(receivedThisMonth._sum.value ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {receivedThisMonth._count} cobrança{receivedThisMonth._count !== 1 && "s"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              A receber (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {fmtBRL(pendingNext30._sum.value ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {pendingNext30._count} cobrança{pendingNext30._count !== 1 && "s"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Vencidas</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-semibold ${
                (overdue._count ?? 0) > 0 ? "text-red-600" : ""
              }`}
            >
              {fmtBRL(overdue._sum.value ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {overdue._count} cobrança{overdue._count !== 1 && "s"}
            </p>
          </CardContent>
        </Card>
      </div>

      {topCategories.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Top categorias avulsas (últimos 90 dias)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {topCategories.map((c) => (
                <div key={c.label} className="flex items-center justify-between text-sm py-1">
                  <span>{c.label}</span>
                  <span className="text-muted-foreground">
                    {c.count} ·{" "}
                    <span className="font-medium text-foreground">
                      {fmtBRL(c.total)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Atividade recente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma cobrança ainda. Gere a primeira a partir de um deal
              aprovado.
            </p>
          ) : (
            <div className="space-y-1">
              {recent.map((c) => (
                <Link
                  key={c.id}
                  href={`/financeiro/cobrancas/${c.id}`}
                  className="flex items-center justify-between py-2 border-b last:border-b-0 text-sm hover:bg-muted/50 rounded px-2 -mx-2 transition-colors"
                >
                  <div>
                    <div className="font-medium">{c.customer.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.description ?? c.deal?.title ?? "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{fmtBRL(c.value)}</div>
                    <Badge variant="outline" className="text-xs">
                      {c.status}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
