"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarRow,
  KpiCard,
  RangePicker,
  rangeToQuery,
  formatUsd,
  formatInt,
  type RangePreset,
} from "@/components/admin/charts";

interface Row {
  key: string;
  label: string;
  costUsd: number;
  calls: number;
  totalTokens: number;
}

interface AiMetricsResponse {
  totals: { costUsd: number; calls: number; totalTokens: number };
  byAgent: Row[];
  byModel: Row[];
  byOperation: Row[];
  byOrg: Row[];
}

/** Chaves sintéticas da API — recebem cor própria pra não passarem por agente. */
const SYNTHETIC_COLORS: Record<string, string> = {
  __infra__: "hsl(215 15% 55%)",
  __none__: "hsl(30 80% 55%)",
  __platform__: "hsl(260 50% 60%)",
};

export function RowsCard({ title, rows, hint }: { title: string; rows: Row[]; hint?: string }) {
  const max = rows.length ? rows[0].costUsd : 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">Sem uso no período.</p>
        )}
        {rows.map((r) => (
          <BarRow
            key={r.key}
            label={r.label}
            value={r.costUsd}
            max={max}
            color={SYNTHETIC_COLORS[r.key]}
            display={`${formatUsd(r.costUsd)} · ${formatInt(r.calls)} chamadas`}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function AiMetricsClient() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [data, setData] = useState<AiMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/metrics/ai?${rangeToQuery(preset)}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Falha ao carregar métricas");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Falha de rede");
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Custo de IA no período {loading && "· carregando…"}
        </p>
        <RangePicker value={preset} onChange={setPreset} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label="Custo total" value={formatUsd(data.totals.costUsd)} />
            <KpiCard label="Chamadas" value={formatInt(data.totals.calls)} />
            <KpiCard label="Tokens" value={formatInt(data.totals.totalTokens)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RowsCard
              title="Por agente"
              rows={data.byAgent}
              hint="Infraestrutura = embeddings, classificadores e memória — encanamento, não agente. Não atribuído = histórico anterior à coluna."
            />
            <RowsCard
              title="Por modelo"
              rows={data.byModel}
              hint="Modelo aposentado aparecendo aqui = env ou perfil desatualizado."
            />
            <RowsCard title="Por operação" rows={data.byOperation} />
            <RowsCard
              title="Por tenant"
              rows={data.byOrg}
              hint="Plataforma = custo sem tenant (base de conhecimento universal)."
            />
          </div>
        </>
      )}
    </div>
  );
}
