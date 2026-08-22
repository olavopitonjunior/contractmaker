"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Activity,
  DollarSign,
  Gauge,
  AlertTriangle,
  RefreshCw,
  Sparkles,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────────
// Types mirror the /api/ai-usage response
// ────────────────────────────────────────────────────────────────────────────

/** Custo por agente — `agentKey: null` é a linha "Não atribuído". */
interface AgentStat {
  agentKey: string | null;
  label: string;
  costUsd: number;
  calls: number;
  totalTokens: number;
}

interface Totals {
  costUsd: number;
  /**
   * Procedência do `costUsd`. Opcional porque a rota só passou a mandar
   * agora — uma aba aberta antes do deploy não pode quebrar.
   */
  cost?: {
    reportedUsd: number;
    estimatedUsd: number;
    reportedCalls: number;
    estimatedCalls: number;
  };
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  avgLatencyMs: number;
  errorRate: number;
  failures: number;
}

interface DayBucket {
  date: string;
  costUsd: number;
  calls: number;
  tokens: number;
}

interface ModelStat {
  model: string;
  provider: string;
  costUsd: number;
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
}

interface OperationStat {
  operation: string;
  costUsd: number;
  calls: number;
  totalTokens: number;
}

interface ProviderStat {
  provider: string;
  costUsd: number;
  calls: number;
  totalTokens: number;
}

interface UserStat {
  userId: string;
  name: string | null;
  email: string | null;
  costUsd: number;
  calls: number;
}

interface ContractStat {
  contractId: string;
  title: string;
  dealId: string | null;
  costUsd: number;
  calls: number;
}

interface ErrorRow {
  id: string;
  model: string;
  provider: string;
  operation: string;
  errorMessage: string | null;
  createdAt: string;
}

interface UsageResponse {
  range: { from: string; to: string };
  totals: Totals;
  byDay: DayBucket[];
  byModel: ModelStat[];
  byOperation: OperationStat[];
  byAgent: AgentStat[];
  byProvider: ProviderStat[];
  byUser: UserStat[];
  byContract: ContractStat[];
  recentErrors: ErrorRow[];
}

// ────────────────────────────────────────────────────────────────────────────
// Formatters
// ────────────────────────────────────────────────────────────────────────────

/**
 * Valor pequeno com precisão de verdade.
 *
 * O `formatUsd` colapsa TUDO abaixo de um centavo em `"$ <0,01"` — inclusive
 * zero. Serve para o KPI, e não serve para a linha de procedência: um turn do
 * Max custa ~US$ 0,0004, então "medido vs estimado" apareceria como
 * `$ <0,01 · $ <0,01` — escondendo exatamente a diferença que a linha existe
 * para mostrar. E com zero estimado ela AFIRMARIA um custo que não existe.
 */
export function formatUsdPreciso(v: number): string {
  if (v === 0) return "$ 0";
  if (v < 0.01) return `$ ${v.toFixed(6).replace(".", ",")}`;
  return formatUsd(v);
}

function formatUsd(v: number): string {
  if (v < 0.01) return "$ <0,01";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function formatInt(v: number): string {
  return new Intl.NumberFormat("pt-BR").format(v);
}

function formatMs(v: number): string {
  if (v < 1000) return `${v}ms`;
  return `${(v / 1000).toFixed(1)}s`;
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(d);
}

const OPERATION_LABELS: Record<string, string> = {
  chat: "Chat IA",
  passive_open: "Análise on-open",
  passive_edit: "Análise on-edit",
  ocr_form: "OCR do formulário",
  ocr_tool: "OCR via ferramenta",
  embed_kb: "Embedding — KB",
  embed_memory: "Embedding — memória",
  embed_query: "Embedding — query",
  summarize_memory: "Resumo pós-aprovação",
  clause_generate: "Gerar cláusula",
  doc_analysis: "Análise de documento",
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "hsl(27 92% 44%)", // primary orange
  gemini: "hsl(200 80% 55%)", // blue
  voyage: "hsl(270 70% 60%)", // purple
};

// ────────────────────────────────────────────────────────────────────────────
// Small CSS-only chart primitives
// ────────────────────────────────────────────────────────────────────────────

function BarRow({
  label,
  value,
  max,
  color,
  suffix,
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  color?: string;
  suffix?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs gap-3">
        <div className="flex-1 min-w-0 truncate">{label}</div>
        <div className="text-muted-foreground tabular-nums">
          {suffix ?? formatUsd(value)}
        </div>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
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

function LineChart({ data }: { data: DayBucket[] }) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
        Sem dados no período
      </div>
    );
  }
  const maxCost = Math.max(...data.map((d) => d.costUsd), 0.01);
  const width = 600;
  const height = 160;
  const padTop = 10;
  const padBottom = 24;
  const padLeft = 36;
  const padRight = 10;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data
    .map((d, i) => {
      const x = padLeft + i * step;
      const y = padTop + innerH - (d.costUsd / maxCost) * innerH;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPath = `M ${padLeft},${padTop + innerH} L ${points} L ${padLeft + (data.length - 1) * step},${padTop + innerH} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-48"
      preserveAspectRatio="none"
    >
      {/* Gridlines + Y labels */}
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
            <text
              x={padLeft - 4}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="hsl(var(--muted-foreground))"
            >
              {formatUsd(maxCost * frac).replace("$", "$")}
            </text>
          </g>
        );
      })}
      {/* Filled area under the curve */}
      <path d={areaPath} fill="hsl(var(--primary))" fillOpacity="0.15" />
      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Data points */}
      {data.map((d, i) => {
        const x = padLeft + i * step;
        const y = padTop + innerH - (d.costUsd / maxCost) * innerH;
        return (
          <circle
            key={d.date}
            cx={x}
            cy={y}
            r="2.5"
            fill="hsl(var(--primary))"
          >
            <title>{`${d.date}: ${formatUsd(d.costUsd)} (${d.calls} chamadas)`}</title>
          </circle>
        );
      })}
      {/* X labels — first, middle, last */}
      {[0, Math.floor(data.length / 2), data.length - 1]
        .filter((i, idx, arr) => arr.indexOf(i) === idx && data[i])
        .map((i) => {
          const x = padLeft + i * step;
          return (
            <text
              key={i}
              x={x}
              y={height - 6}
              textAnchor="middle"
              fontSize="9"
              fill="hsl(var(--muted-foreground))"
            >
              {formatDateShort(data[i].date)}
            </text>
          );
        })}
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main client
// ────────────────────────────────────────────────────────────────────────────

type RangePreset = "7d" | "30d" | "mtd" | "last_month";

function presetRange(preset: RangePreset): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  if (preset === "7d") {
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from, to };
  }
  if (preset === "30d") {
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from, to };
  }
  if (preset === "mtd") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to };
  }
  // last_month
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  return { from, to: endLastMonth };
}

export function AIUsageClient() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => presetRange(preset), [preset]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: range.from.toISOString().slice(0, 10),
        to: range.to.toISOString().slice(0, 10),
      });
      const res = await fetch(`/api/ai-usage?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as UsageResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const maxModelCost = useMemo(() => {
    if (!data) return 0;
    return data.byModel.reduce((m, x) => Math.max(m, x.costUsd), 0);
  }, [data]);

  const maxAgentCost = useMemo(() => {
    if (!data) return 0;
    return (data.byAgent ?? []).reduce((m, x) => Math.max(m, x.costUsd), 0);
  }, [data]);

  const maxOperationCost = useMemo(() => {
    if (!data) return 0;
    return data.byOperation.reduce((m, x) => Math.max(m, x.costUsd), 0);
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Configurações
            </Link>
          </Button>
          <h1 className="font-display tracking-tight text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Observabilidade de IA
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Custos, chamadas, tokens e latência de todos os modelos usados pela
            organização (Claude, Gemini, Voyage). Dados são registrados
            automaticamente a cada chamada e agregados por período.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`}
            />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Period filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {(
          [
            { id: "7d", label: "Últimos 7 dias" },
            { id: "30d", label: "Últimos 30 dias" },
            { id: "mtd", label: "Mês atual" },
            { id: "last_month", label: "Mês anterior" },
          ] as Array<{ id: RangePreset; label: string }>
        ).map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant={preset === p.id ? "default" : "outline"}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </Button>
        ))}
        {data && (
          <span className="text-xs text-muted-foreground ml-2">
            {new Date(data.range.from).toLocaleDateString("pt-BR")} →{" "}
            {new Date(data.range.to).toLocaleDateString("pt-BR")}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Erro ao carregar: {error}
        </div>
      )}

      {!data && !error && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          Carregando…
        </div>
      )}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5" /> Custo total
                </div>
                <p className="text-2xl font-semibold mt-1 tabular-nums">
                  {formatUsd(data.totals.costUsd)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {data.totals.calls} chamadas
                </p>
                {/* Medido vs estimado. Um total sem procedência esconde que a
                    parte estimada pode estar bem acima do real quando há cache
                    de prefixo — 304% no caso medido em 21/08. */}
                {data.totals.cost && data.totals.cost.reportedCalls > 0 && (
                  <p
                    className="text-[10px] text-muted-foreground mt-1 leading-snug"
                    title="Medido = crédito real cobrado pelo provedor. Estimado = tabela de preços interna, que não enxerga cache de prefixo e pode superestimar."
                  >
                    {formatUsdPreciso(data.totals.cost.reportedUsd)} medido em{" "}
                    {data.totals.cost.reportedCalls}
                    {/* A metade estimada só aparece quando existe: com tudo
                        medido, escrever "$ 0 estimado" afirmaria um custo que
                        não há. */}
                    {data.totals.cost.estimatedCalls > 0 && (
                      <>
                        {" · "}
                        {formatUsdPreciso(data.totals.cost.estimatedUsd)} estimado em{" "}
                        {data.totals.cost.estimatedCalls}
                      </>
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" /> Tokens
                </div>
                <p className="text-2xl font-semibold mt-1 tabular-nums">
                  {formatInt(
                    data.totals.promptTokens + data.totals.completionTokens
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatInt(data.totals.promptTokens)} in ·{" "}
                  {formatInt(data.totals.completionTokens)} out
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Gauge className="h-3.5 w-3.5" /> Latência média
                </div>
                <p className="text-2xl font-semibold mt-1 tabular-nums">
                  {formatMs(data.totals.avgLatencyMs)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Todas as chamadas
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" /> Taxa de erro
                </div>
                <p
                  className={`text-2xl font-semibold mt-1 tabular-nums ${
                    data.totals.errorRate > 0.05
                      ? "text-destructive"
                      : data.totals.errorRate > 0.01
                        ? "text-amber-600"
                        : ""
                  }`}
                >
                  {formatPct(data.totals.errorRate)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {data.totals.failures} falhas
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Cost over time */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Custo por dia</CardTitle>
            </CardHeader>
            <CardContent>
              <LineChart data={data.byDay} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* By model */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Top modelos por custo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.byModel.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem dados.</p>
                ) : (
                  data.byModel.slice(0, 6).map((m) => (
                    <BarRow
                      key={m.model}
                      label={
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{
                              background: PROVIDER_COLORS[m.provider],
                            }}
                          />
                          <span className="truncate">{m.model}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            · {m.calls} · {formatMs(m.avgLatencyMs)}
                          </span>
                        </div>
                      }
                      value={m.costUsd}
                      max={maxModelCost}
                      color={PROVIDER_COLORS[m.provider]}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            {/* By operation */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Por operação</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.byOperation.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem dados.</p>
                ) : (
                  data.byOperation.map((o) => (
                    <BarRow
                      key={o.operation}
                      label={
                        <span className="truncate">
                          {OPERATION_LABELS[o.operation] || o.operation}{" "}
                          <span className="text-[10px] text-muted-foreground">
                            · {o.calls}
                          </span>
                        </span>
                      }
                      value={o.costUsd}
                      max={maxOperationCost}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Por agente — a pergunta que o console de agentes cria: "quanto
              custa o Editor?". Vem antes de provedor porque é a dimensão que o
              operador controla (modelo, teto e liga/desliga são por agente). */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Por agente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data.byAgent ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem dados.</p>
              ) : (
                (data.byAgent ?? []).map((a) => (
                  <BarRow
                    key={a.agentKey ?? "sem-agente"}
                    label={
                      <span className="truncate">
                        {a.label}{" "}
                        <span className="text-[10px] text-muted-foreground">
                          · {a.calls}
                        </span>
                      </span>
                    }
                    value={a.costUsd}
                    max={maxAgentCost}
                  />
                ))
              )}
              {(data.byAgent ?? []).some((a) => a.agentKey === null) && (
                <p className="text-[11px] text-muted-foreground">
                  &quot;Não atribuído&quot; reúne o passo de síntese do
                  orquestrador — que não é um agente configurável — e as chamadas
                  anteriores a esta medição.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* By provider */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Por provedor</CardTitle>
              </CardHeader>
              <CardContent>
                {data.byProvider.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem dados.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {data.byProvider.map((p) => (
                      <div
                        key={p.provider}
                        className="rounded border p-3 text-center"
                      >
                        <div
                          className="mx-auto h-2 w-12 rounded-full mb-2"
                          style={{ background: PROVIDER_COLORS[p.provider] }}
                        />
                        <p className="text-sm font-semibold">{p.provider}</p>
                        <p className="text-base font-semibold tabular-nums mt-1">
                          {formatUsd(p.costUsd)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {p.calls} chamadas
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top users */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Top usuários</CardTitle>
              </CardHeader>
              <CardContent>
                {data.byUser.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sem dados identificados.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.byUser.map((u) => (
                      <li
                        key={u.userId}
                        className="flex items-center justify-between text-xs gap-2"
                      >
                        <span className="truncate">
                          {u.name || u.email || u.userId}
                        </span>
                        <span className="tabular-nums text-muted-foreground shrink-0">
                          {formatUsd(u.costUsd)} · {u.calls}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top contracts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Top contratos por custo</CardTitle>
            </CardHeader>
            <CardContent>
              {data.byContract.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum contrato identificado no período.
                </p>
              ) : (
                <ul className="divide-y">
                  {data.byContract.map((c) => (
                    <li
                      key={c.contractId}
                      className="flex items-center justify-between py-2 text-sm gap-2"
                    >
                      <Link
                        href={`/contracts/${c.contractId}`}
                        className="truncate hover:underline flex-1 min-w-0"
                      >
                        {c.title}
                      </Link>
                      <span className="tabular-nums text-muted-foreground text-xs shrink-0">
                        {formatUsd(c.costUsd)} · {c.calls} chamadas
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Recent errors */}
          {data.recentErrors.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Erros recentes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.recentErrors.map((e) => (
                    <li
                      key={e.id}
                      className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px]">
                          {e.provider} · {e.model}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(e.createdAt).toLocaleString("pt-BR")}
                        </span>
                      </div>
                      <p className="font-mono text-[11px] text-destructive/80 break-words">
                        [{e.operation}] {e.errorMessage || "(sem mensagem)"}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
