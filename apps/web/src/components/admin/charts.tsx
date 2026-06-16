"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Primitivas de chart CSS-only (sem recharts) para o painel super-admin.
 * Auto-contidas — espelham o padrão do AIUsageClient mas independentes pra não
 * acoplar/regredir o dashboard de IA existente.
 */

// ── Formatters ──────────────────────────────────────────────────────────────

export function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return "$ <0,01";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function formatInt(v: number): string {
  return new Intl.NumberFormat("pt-BR").format(v);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDateShort(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(
    new Date(iso)
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

export function KpiCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub != null && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ── BarRow ─────────────────────────────────────────────────────────────────

export function BarRow({
  label,
  value,
  max,
  color,
  display,
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  color?: string;
  display?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="min-w-0 flex-1 truncate">{label}</div>
        <div className="tabular-nums text-muted-foreground">
          {display ?? formatInt(value)}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div
          className="h-full rounded transition-all"
          style={{
            width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
            background: color ?? "hsl(var(--primary))",
          }}
        />
      </div>
    </div>
  );
}

/** Distribuição categórica (status/kind) como barras. `record` = {chave: contagem}. */
export function DistBars({
  record,
  colorByKey,
  displayByKey,
}: {
  record: Record<string, number>;
  colorByKey?: (k: string) => string | undefined;
  displayByKey?: (k: string, v: number) => string | undefined;
}) {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem dados.</p>;
  }
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <BarRow
          key={k}
          label={k}
          value={v}
          max={max}
          color={colorByKey?.(k)}
          display={displayByKey?.(k, v)}
        />
      ))}
    </div>
  );
}

// ── LineChart (série diária) ──────────────────────────────────────────────────

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
  count?: number;
}

export function LineChart({
  data,
  valueFormat = (v) => String(v),
}: {
  data: SeriesPoint[];
  valueFormat?: (v: number) => string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        Sem dados no período
      </div>
    );
  }
  const maxV = Math.max(...data.map((d) => d.value), 0.0001);
  const width = 600;
  const height = 160;
  const padTop = 10;
  const padBottom = 24;
  const padLeft = 44;
  const padRight = 10;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data
    .map((d, i) => {
      const x = padLeft + i * step;
      const y = padTop + innerH - (d.value / maxV) * innerH;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPath = `M ${padLeft},${padTop + innerH} L ${points} L ${padLeft + (data.length - 1) * step},${padTop + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" preserveAspectRatio="none">
      {[0, 0.5, 1].map((frac) => {
        const y = padTop + innerH - frac * innerH;
        return (
          <g key={frac}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke="hsl(var(--border))"
              strokeWidth="0.5"
              strokeDasharray={frac === 0 ? "" : "2,2"}
            />
            <text x={padLeft - 4} y={y + 3} textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">
              {valueFormat(maxV * frac)}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill="hsl(var(--primary))" fillOpacity="0.15" />
      <polyline
        points={points}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const x = padLeft + i * step;
        const y = padTop + innerH - (d.value / maxV) * innerH;
        return (
          <circle key={d.date} cx={x} cy={y} r="2.5" fill="hsl(var(--primary))">
            <title>{`${d.date}: ${valueFormat(d.value)}${d.count != null ? ` (${d.count})` : ""}`}</title>
          </circle>
        );
      })}
      {[0, Math.floor(data.length / 2), data.length - 1]
        .filter((i, idx, arr) => arr.indexOf(i) === idx && data[i])
        .map((i) => {
          const x = padLeft + i * step;
          return (
            <text key={i} x={x} y={height - 6} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">
              {formatDateShort(data[i].date)}
            </text>
          );
        })}
    </svg>
  );
}

// ── Range picker ──────────────────────────────────────────────────────────────

export type RangePreset = "7d" | "30d" | "mtd" | "last_month";

export const RANGE_LABELS: Record<RangePreset, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  mtd: "Mês atual",
  last_month: "Mês passado",
};

export function presetRange(preset: RangePreset): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  if (preset === "7d") return { from: new Date(now.getTime() - 7 * 86400000), to };
  if (preset === "30d") return { from: new Date(now.getTime() - 30 * 86400000), to };
  if (preset === "mtd") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  return { from, to: end };
}

export function RangePicker({
  value,
  onChange,
}: {
  value: RangePreset;
  onChange: (p: RangePreset) => void;
}) {
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5 text-xs">
      {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`rounded px-2.5 py-1 transition-colors ${
            value === p ? "bg-primary text-primary-foreground" : "hover:bg-accent"
          }`}
        >
          {RANGE_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

export function rangeToQuery(preset: RangePreset): string {
  const { from, to } = presetRange(preset);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
}
