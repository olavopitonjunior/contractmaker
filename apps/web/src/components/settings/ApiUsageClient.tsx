"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Activity,
  AlertTriangle,
  Gauge,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface UsageData {
  from: string;
  to: string;
  totals: {
    calls: number;
    errors: number;
    errorRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  };
  days: Array<{ day: string; calls: number; errors: number }>;
  topEndpoints: Array<{ endpoint: string; calls: number; avgLatency: number }>;
  topTokens: Array<{ tokenId: string; tokenName: string; calls: number }>;
  recentErrors: Array<{
    id: string;
    method: string;
    path: string;
    statusCode: number;
    errorCode: string | null;
    createdAt: string;
  }>;
  tokens: Array<{ id: string; name: string }>;
}

const PERIODS = [
  { id: "7d", label: "Últimos 7 dias", days: 7 },
  { id: "30d", label: "Últimos 30 dias", days: 30 },
  { id: "90d", label: "Últimos 90 dias", days: 90 },
] as const;

export function ApiUsageClient() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("7d");
  const [tokenId, setTokenId] = useState<string>("all");

  async function load() {
    setLoading(true);
    const cfg = PERIODS.find((p) => p.id === period)!;
    const to = new Date();
    const from = new Date(to.getTime() - cfg.days * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (tokenId && tokenId !== "all") params.set("tokenId", tokenId);
    try {
      const res = await fetch(`/api/api-usage?${params.toString()}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, tokenId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Activity className="h-6 w-6" />
          Uso da API (Newton)
        </h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto"
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tokenId} onValueChange={setTokenId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Todos os tokens" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tokens</SelectItem>
            {data?.tokens.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Sem dados.</p>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Chamadas"
              value={data.totals.calls.toLocaleString("pt-BR")}
              icon={<Activity className="h-4 w-4" />}
            />
            <KpiCard
              label="Erros"
              value={`${data.totals.errors} (${(data.totals.errorRate * 100).toFixed(1)}%)`}
              icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
              variant={data.totals.errorRate > 0.05 ? "warning" : undefined}
            />
            <KpiCard
              label="Latência p50"
              value={`${data.totals.p50LatencyMs} ms`}
              icon={<Gauge className="h-4 w-4" />}
            />
            <KpiCard
              label="Latência p95"
              value={`${data.totals.p95LatencyMs} ms`}
              icon={<Gauge className="h-4 w-4" />}
            />
          </div>

          {/* Daily chart */}
          <Card>
            <CardHeader>
              <CardTitle>Chamadas por dia</CardTitle>
            </CardHeader>
            <CardContent>
              {data.days.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Sem chamadas no período.
                </p>
              ) : (
                <div className="space-y-1">
                  {(() => {
                    const max = Math.max(...data.days.map((d) => d.calls), 1);
                    return data.days.map((d) => {
                      const pct = (d.calls / max) * 100;
                      const errPct = d.calls > 0 ? (d.errors / d.calls) * 100 : 0;
                      return (
                        <div key={d.day} className="flex items-center gap-3 text-xs">
                          <div className="w-20 font-mono text-muted-foreground">
                            {d.day.slice(5)}
                          </div>
                          <div className="flex-1 h-5 bg-muted/40 rounded relative overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 bg-blue-500/70"
                              style={{ width: `${pct}%` }}
                            />
                            {errPct > 0 && (
                              <div
                                className="absolute inset-y-0 right-0 bg-red-500/70"
                                style={{ width: `${(d.errors / max) * 100}%` }}
                              />
                            )}
                          </div>
                          <div className="w-16 text-right font-mono">
                            {d.calls}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top endpoints */}
          <Card>
            <CardHeader>
              <CardTitle>Top endpoints</CardTitle>
            </CardHeader>
            <CardContent>
              {data.topEndpoints.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">—</p>
              ) : (
                <div className="space-y-2">
                  {data.topEndpoints.map((e) => (
                    <div
                      key={e.endpoint}
                      className="flex items-center justify-between text-sm border-b last:border-0 py-1"
                    >
                      <code className="text-xs font-mono">{e.endpoint}</code>
                      <div className="flex gap-3 text-muted-foreground text-xs">
                        <span>{e.calls.toLocaleString("pt-BR")} calls</span>
                        <span>{e.avgLatency} ms avg</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top tokens */}
          <Card>
            <CardHeader>
              <CardTitle>Top tokens</CardTitle>
            </CardHeader>
            <CardContent>
              {data.topTokens.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Apenas chamadas via session (sem Bearer token).
                </p>
              ) : (
                <div className="space-y-2">
                  {data.topTokens.map((t) => (
                    <div
                      key={t.tokenId}
                      className="flex items-center justify-between text-sm border-b last:border-0 py-1"
                    >
                      <span>{t.tokenName}</span>
                      <span className="text-muted-foreground text-xs font-mono">
                        {t.calls.toLocaleString("pt-BR")} calls
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent errors */}
          <Card>
            <CardHeader>
              <CardTitle>Erros recentes</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Sem erros no período.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.recentErrors.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 text-xs border-b last:border-0 py-1"
                    >
                      <Badge variant="destructive" className="font-mono text-[10px]">
                        {e.statusCode}
                      </Badge>
                      <code className="font-mono">
                        {e.method} {e.path}
                      </code>
                      {e.errorCode && (
                        <span className="text-muted-foreground">{e.errorCode}</span>
                      )}
                      <span className="ml-auto text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  variant,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  variant?: "warning";
}) {
  return (
    <Card className={variant === "warning" ? "border-amber-300" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="text-xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
