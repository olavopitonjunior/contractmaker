"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarRow,
  KpiCard,
  RangePicker,
  rangeToQuery,
  formatInt,
  type RangePreset,
} from "@/components/admin/charts";

/** Fetch + range compartilhados das duas abas — mesmo esqueleto do AiMetricsClient. */
function useMetrics<T>(endpoint: string) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${endpoint}?${rangeToQuery(preset)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Falha ao carregar");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [endpoint, preset]);

  useEffect(() => {
    void load();
  }, [load]);

  return { preset, setPreset, data, error };
}

// ── API / MCP ────────────────────────────────────────────────────────────────

interface ApiMetrics {
  totals: { calls: number; errors: number; errorRate: number };
  byVia: Array<{ via: string; calls: number }>;
  byPath: Array<{ path: string; via: string; calls: number }>;
  byToken: Array<{
    tokenId: string | null;
    name: string;
    scopes: string[];
    revoked: boolean;
    calls: number;
  }>;
  byOrg: Array<{ orgId: string; name: string; calls: number }>;
  byStatusClass: Array<{ statusClass: string; calls: number }>;
}

export function ApiMetricsClient() {
  const { preset, setPreset, data, error } = useMetrics<ApiMetrics>(
    "/api/admin/metrics/api"
  );

  const maxPath = data?.byPath[0]?.calls ?? 0;
  const maxOrg = data?.byOrg[0]?.calls ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Chamadas de API no período — o MCP (Newton/Max) entra como{" "}
          <code className="font-mono text-xs">bearer</code>.
        </p>
        <RangePicker value={preset} onChange={setPreset} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Chamadas" value={formatInt(data.totals.calls)} />
            <KpiCard
              label="Erros (4xx+5xx)"
              value={formatInt(data.totals.errors)}
              sub={`${data.totals.errorRate}%`}
            />
            {data.byVia.map((v) => (
              <KpiCard key={v.via} label={`via ${v.via}`} value={formatInt(v.calls)} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Tokens (bearer = integrações e MCP)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.byToken.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma chamada bearer no período.
                  </p>
                )}
                {data.byToken.map((t) => (
                  <div
                    key={t.tokenId ?? "_"}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{t.name}</span>
                      {t.revoked && <Badge variant="destructive">revogado</Badge>}
                      <span className="truncate text-muted-foreground">
                        {t.scopes.join(" ")}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatInt(t.calls)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.byStatusClass.map((s) => (
                  <BarRow
                    key={s.statusClass}
                    label={s.statusClass}
                    value={s.calls}
                    max={data.totals.calls}
                    color={
                      s.statusClass >= "4xx" ? "hsl(30 80% 55%)" : undefined
                    }
                  />
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top endpoints</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.byPath.map((p) => (
                  <BarRow
                    key={`${p.via}:${p.path}`}
                    label={
                      <span>
                        <code className="font-mono text-[11px]">{p.path}</code>{" "}
                        <span className="text-muted-foreground">({p.via})</span>
                      </span>
                    }
                    value={p.calls}
                    max={maxPath}
                  />
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Por tenant</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.byOrg.map((o) => (
                  <BarRow key={o.orgId} label={o.name} value={o.calls} max={maxOrg} />
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ── Auditoria ────────────────────────────────────────────────────────────────

interface AuditMetrics {
  byResult: Array<{ result: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
  problems: Array<{
    orgId: string | null;
    orgName: string;
    action: string;
    result: string;
    count: number;
  }>;
}

export function AuditMetricsClient() {
  const { preset, setPreset, data, error } = useMetrics<AuditMetrics>(
    "/api/admin/metrics/audit"
  );
  const maxAction = data?.topActions[0]?.count ?? 0;
  const totalResult = data?.byResult.reduce((a, r) => a + r.count, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          AuditLog cross-tenant — FAILURE/DENIED por org é o insumo do motor de
          alerta (fase 2).
        </p>
        <RangePicker value={preset} onChange={setPreset} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Resultado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.byResult.map((r) => (
                <BarRow
                  key={r.result}
                  label={r.result}
                  value={r.count}
                  max={totalResult}
                  color={r.result !== "SUCCESS" ? "hsl(0 70% 55%)" : undefined}
                />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">O que não deu certo, onde</CardTitle>
              <p className="text-xs text-muted-foreground">
                FAILURE/DENIED por org e ação.
              </p>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.problems.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nada falhou no período.
                </p>
              )}
              {data.problems.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{p.orgName}</span>{" "}
                    <code className="font-mono text-[11px]">{p.action}</code>{" "}
                    <Badge
                      variant={p.result === "DENIED" ? "secondary" : "destructive"}
                      className="text-[10px]"
                    >
                      {p.result}
                    </Badge>
                  </span>
                  <span className="tabular-nums">{p.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Ações mais frequentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.topActions.map((a) => (
                <BarRow
                  key={a.action}
                  label={<code className="font-mono text-[11px]">{a.action}</code>}
                  value={a.count}
                  max={maxAction}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
