"use client";

import { useEffect, useMemo, useState } from "react";
import { presetRange, rotuloDia, type RangePreset } from "@/lib/ui/date-range";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  FileSignature,
  RefreshCw,
  Activity,
  Gauge,
  TrendingUp,
  Inbox,
} from "lucide-react";


interface RecentEnvelope {
  id: string;
  name: string;
  status: string;
  sentAt: string | null;
  closedAt: string | null;
  contractId: string;
  dealId: string;
  signerCount: number;
}

interface RecentEvent {
  id: string;
  eventName: string;
  receivedAt: string;
  envelopeId: string;
  source: string;
}

interface MetricsResponse {
  range: { from: string; to: string };
  /** Consumo do plano no mês: envelopes ativados + Aceites WhatsApp. Independe
   *  do range do filtro. */
  envelopesMonth: number;
  totalEnvelopes: number;
  byStatus: Record<string, number>;
  closeRate: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  recentEnvelopes: RecentEnvelope[];
  recentEvents: RecentEvent[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  running: "Em andamento",
  closed: "Concluído",
  canceled: "Cancelado",
  failed: "Falhou",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  running: "secondary",
  closed: "default",
  canceled: "outline",
  failed: "destructive",
};


function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(0)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(0)}min`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(1)}h`;
  return `${(hr / 24).toFixed(1)}d`;
}


export function SignaturesClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => presetRange(preset), [preset]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      // Já vem `YYYY-MM-DD` em UTC do helper compartilhado — sem `.slice()`
      // aqui, que era onde a conta local virava data UTC deslocada.
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const res = await fetch(`/api/signatures/metrics?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as MetricsResponse;
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {embedded ? (
          <div>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Volume, taxa de conclusão, latência e histórico de eventos dos
              envelopes ClickSign.
            </p>
          </div>
        ) : (
          <div>
            <Button variant="ghost" size="sm" asChild className="mb-2">
              <Link href="/settings">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Configurações
              </Link>
            </Button>
            <h1 className="font-display tracking-tight text-2xl font-semibold flex items-center gap-2">
              <FileSignature className="h-6 w-6 text-primary" />
              Assinaturas eletrônicas
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Visão consolidada dos envelopes Clicksign emitidos pela
              organização: volume, taxa de conclusão, latência e histórico de
              eventos.
            </p>
          </div>
        )}
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
            {rotuloDia(data.range.from)} → {rotuloDia(data.range.to)}
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
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileSignature className="h-3.5 w-3.5" /> Envelopes no mês
                </div>
                <p className="text-2xl font-semibold mt-1 tabular-nums">
                  {data.envelopesMonth}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  consumidos do plano no mês (inclui Aceites)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" /> Envelopes no período
                </div>
                <p className="text-2xl font-semibold mt-1 tabular-nums">
                  {data.totalEnvelopes}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {Object.entries(data.byStatus)
                    .map(
                      ([k, v]) => `${v} ${STATUS_LABEL[k]?.toLowerCase() ?? k}`
                    )
                    .join(" · ") || "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" /> Taxa de conclusão
                </div>
                <p
                  className={`text-2xl font-semibold mt-1 tabular-nums ${
                    data.closeRate < 0.5 && data.totalEnvelopes > 0
                      ? "text-amber-600"
                      : ""
                  }`}
                >
                  {formatPct(data.closeRate)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {data.byStatus.closed ?? 0} concluídos
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Gauge className="h-3.5 w-3.5" /> Latência (sent → closed)
                </div>
                <p className="text-2xl font-semibold mt-1 tabular-nums">
                  {formatDuration(data.latencyP50Ms)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  p50 · p95 {formatDuration(data.latencyP95Ms)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Envelopes recentes</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentEnvelopes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum envelope no período.
                </p>
              ) : (
                <ul className="divide-y">
                  {data.recentEnvelopes.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={STATUS_VARIANT[e.status] ?? "outline"}>
                            {STATUS_LABEL[e.status] ?? e.status}
                          </Badge>
                          <Link
                            href={`/deals/${e.dealId}?tab=assinaturas`}
                            className="font-medium truncate hover:underline"
                          >
                            {e.name}
                          </Link>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {e.signerCount} signatário(s)
                          {e.sentAt &&
                            ` · enviado ${new Date(e.sentAt).toLocaleDateString("pt-BR")}`}
                          {e.closedAt &&
                            ` · concluído ${new Date(e.closedAt).toLocaleDateString("pt-BR")}`}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4" />
                Eventos recentes (webhook + cron)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum evento registrado.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.recentEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-[10px]">
                          {ev.source}
                        </Badge>
                        <span className="font-mono truncate">
                          {ev.eventName}
                        </span>
                      </div>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {new Date(ev.receivedAt).toLocaleString("pt-BR")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
