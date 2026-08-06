"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface StageChartRow {
  stageName: string;
  medianDays: number | null;
  p90Days: number | null;
  dealsEntered: number;
}

/**
 * Os 2 gráficos do painel (recharts, já dependência): tempo por etapa
 * (mediana × p90, em dias) e passagem por etapa (deals distintos). Client
 * component fino — todos os números chegam prontos do server.
 */
export function PipelineReportCharts({ rows }: { rows: StageChartRow[] }) {
  const data = rows.map((r) => ({
    etapa: r.stageName.length > 14 ? `${r.stageName.slice(0, 13)}…` : r.stageName,
    etapaFull: r.stageName,
    mediana: r.medianDays ?? 0,
    p90: r.p90Days ?? 0,
    negocios: r.dealsEntered,
  }));

  if (data.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Tempo por etapa (dias)</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="etapa" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={54} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v, name) => [
                `${String(v ?? 0)} dia(s)`,
                name === "mediana" ? "Mediana" : "P90",
              ]}
              labelFormatter={(_, payload) => payload[0]?.payload?.etapaFull ?? ""}
            />
            <Bar dataKey="mediana" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            <Bar dataKey="p90" fill="hsl(var(--primary) / 0.35)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Negócios que passaram pela etapa</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="etapa" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={54} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(v) => [`${String(v ?? 0)} negócio(s)`, "Passaram"]}
              labelFormatter={(_, payload) => payload[0]?.payload?.etapaFull ?? ""}
            />
            <Bar dataKey="negocios" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
