import Link from "next/link";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Wallet, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { endpointInfo } from "@/lib/certidoes/endpoints";

export const dynamic = "force-dynamic";

function p50(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.5)];
}

function p95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
}

function brl(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function CertidoesSettingsPage() {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

  // All jobs from deals that belong to this org (via the deal's form.orgId).
  const recent = await prisma.certidaoJob.findMany({
    where: {
      createdAt: { gte: last30 },
      deal: { form: { orgId: org.id } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      endpoint: true,
      status: true,
      latencyMs: true,
      costCents: true,
      errorMessage: true,
      createdAt: true,
      label: true,
      dealId: true,
    },
  });

  const monthJobs = recent.filter((j) => j.createdAt >= firstOfMonth);
  const monthSpend = monthJobs.reduce((a, j) => a + (j.costCents ?? 0), 0);
  const budgetCents = Number(
    process.env.INFOSIMPLES_MONTHLY_BUDGET_CENTS ?? "10000"
  );
  const budgetPct =
    budgetCents > 0 ? Math.min(100, Math.round((monthSpend / budgetCents) * 100)) : 0;

  const totalLast30 = recent.length;
  const successCount = recent.filter((j) => j.status === "success").length;
  const failedCount = recent.filter((j) => j.status === "failed").length;
  const awaitingCount = recent.filter((j) => j.status === "awaiting_portal").length;
  const successRate =
    totalLast30 > 0 ? Math.round((successCount / totalLast30) * 100) : 0;

  // Per-endpoint stats
  const byEndpoint = new Map<
    string,
    {
      total: number;
      success: number;
      failed: number;
      latencies: number[];
    }
  >();
  for (const j of recent) {
    if (!byEndpoint.has(j.endpoint)) {
      byEndpoint.set(j.endpoint, { total: 0, success: 0, failed: 0, latencies: [] });
    }
    const bucket = byEndpoint.get(j.endpoint)!;
    bucket.total++;
    if (j.status === "success") bucket.success++;
    if (j.status === "failed") bucket.failed++;
    if (j.latencyMs != null) bucket.latencies.push(j.latencyMs);
  }
  const endpointRows = Array.from(byEndpoint.entries())
    .map(([endpoint, s]) => ({
      endpoint,
      label: endpointInfo(endpoint).label,
      total: s.total,
      success: s.success,
      failed: s.failed,
      successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
      p50ms: p50(s.latencies),
      p95ms: p95(s.latencies),
    }))
    .sort((a, b) => b.total - a.total);

  // Recent errors (top 10 most recent failures)
  const recentErrors = recent
    .filter((j) => j.status === "failed" && j.errorMessage)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Configurações
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Certidões — Qualidade & Custos</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Gasto do mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{brl(monthSpend)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              de {brl(budgetCents)} · {budgetPct}%
            </p>
            <div className="mt-2 h-1.5 bg-muted rounded overflow-hidden">
              <div
                className={`h-full ${
                  budgetPct >= 90 ? "bg-red-500" : budgetPct >= 70 ? "bg-amber-500" : "bg-green-500"
                }`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Taxa de sucesso
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{successRate}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {successCount}/{totalLast30} nos últimos 30 dias
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" /> Falhas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{failedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">nos últimos 30 dias</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" /> Aguardando portal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{awaitingCount}</p>
            <p className="text-xs text-muted-foreground mt-1">
              pedidos TJSP/TJRJ pendentes
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Por endpoint (últimos 30 dias)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left p-2">Endpoint</th>
                  <th className="text-right p-2">Total</th>
                  <th className="text-right p-2">Sucesso</th>
                  <th className="text-right p-2">Falhas</th>
                  <th className="text-right p-2">Taxa</th>
                  <th className="text-right p-2">Latência p50</th>
                  <th className="text-right p-2">Latência p95</th>
                </tr>
              </thead>
              <tbody>
                {endpointRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      Nenhuma extração nos últimos 30 dias.
                    </td>
                  </tr>
                )}
                {endpointRows.map((row) => (
                  <tr key={row.endpoint} className="border-t">
                    <td className="p-2 font-medium">{row.label}</td>
                    <td className="text-right p-2 tabular-nums">{row.total}</td>
                    <td className="text-right p-2 tabular-nums text-green-700">
                      {row.success}
                    </td>
                    <td className="text-right p-2 tabular-nums text-red-700">
                      {row.failed}
                    </td>
                    <td className="text-right p-2 tabular-nums">
                      <Badge
                        variant="outline"
                        className={
                          row.successRate >= 95
                            ? "border-green-500 text-green-700"
                            : row.successRate >= 80
                            ? "border-amber-500 text-amber-700"
                            : "border-red-500 text-red-700"
                        }
                      >
                        {row.successRate}%
                      </Badge>
                    </td>
                    <td className="text-right p-2 tabular-nums">
                      {row.p50ms > 0 ? `${Math.round(row.p50ms / 1000)}s` : "—"}
                    </td>
                    <td className="text-right p-2 tabular-nums">
                      {row.p95ms > 0 ? `${Math.round(row.p95ms / 1000)}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {recentErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Erros recentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recentErrors.map((err) => (
                <li key={err.id} className="text-xs border rounded p-2">
                  <div className="flex justify-between gap-2 mb-1">
                    <Link
                      href={`/deals/${err.dealId}`}
                      className="font-medium truncate hover:underline"
                    >
                      {err.label}
                    </Link>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(err.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="text-muted-foreground font-mono text-[11px]">
                    {err.errorMessage}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
