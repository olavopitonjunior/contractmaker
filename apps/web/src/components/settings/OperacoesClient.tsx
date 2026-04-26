"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Wallet,
  Send,
  FileText,
  Clock,
} from "lucide-react";

interface OperacoesData {
  period: { from: string; to: string };
  webhooks: {
    total: number;
    withError: number;
    unprocessed: number;
    successRate: number | null;
    avgLatencyMs: number;
    byEvent: Array<{ event: string; count: number }>;
    lastReceivedAt: string | null;
    recentErrors: Array<{
      eventId: string;
      event: string;
      receivedAt: string;
      error: string;
    }>;
  };
  transfers: {
    byStatus: Array<{ status: string; count: number }>;
    byOrigin: Array<{ origin: string; count: number }>;
    failedSplitsRetryable: number;
  };
  charges: {
    pending: number;
    overdue: number;
    recentlyReceived: number;
  };
}

interface AsaasHealthData {
  ok: boolean;
  asaasEnv: string;
  accountStatus: {
    general: string;
    commercialInfo: string;
    bankAccountInfo: string;
    documentation: string;
  } | null;
  accountStatusError: string | null;
  balance: {
    total: number | null;
    available: number | null;
    blocked: number | null;
    pending: number | null;
  } | null;
  balanceError: string | null;
  lastWebhook: {
    receivedAt: string;
    event: string;
    ageMinutes: number;
  } | null;
  errors7d: number;
}

function fmtBRL(v: number | null) {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtRelativeMinutes(min: number | null) {
  if (min === null) return "nunca";
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atrás`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h atrás`;
  return `${Math.floor(min / (24 * 60))}d atrás`;
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case "APPROVED":
    case "DONE":
    case "RECEIVED":
      return "bg-green-100 text-green-900 border-green-300";
    case "AWAITING_APPROVAL":
    case "PENDING":
    case "PENDING_DISPATCH":
    case "BANK_PROCESSING":
      return "bg-amber-100 text-amber-900 border-amber-300";
    case "REJECTED":
    case "FAILED":
    case "OVERDUE":
      return "bg-red-100 text-red-900 border-red-300";
    default:
      return "bg-gray-100 text-gray-800 border-gray-300";
  }
}

export function OperacoesClient() {
  const [data, setData] = useState<OperacoesData | null>(null);
  const [health, setHealth] = useState<AsaasHealthData | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [opsRes, healthRes] = await Promise.all([
        fetch("/api/admin/operacoes", { credentials: "include" }),
        fetch("/api/admin/asaas-health", { credentials: "include" }),
      ]);
      if (opsRes.ok) setData(await opsRes.json());
      else toast.error("Falha ao carregar operações");
      if (healthRes.ok) setHealth(await healthRes.json());
      else toast.error("Falha ao carregar health Asaas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 60000);
    return () => clearInterval(t);
  }, []);

  if (!data || !health) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" /> Configurações
          </Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Carregando…
          </CardContent>
        </Card>
      </div>
    );
  }

  const webhookStatus =
    data.webhooks.unprocessed > 0
      ? "warning"
      : data.webhooks.withError > 0
        ? "warning"
        : "ok";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4 mr-1" /> Configurações
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Observabilidade de operações
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Saúde da integração Asaas, webhooks recebidos, transferências
            disparadas e pendências de cobrança. Atualiza a cada 60s.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={loadAll}
          disabled={loading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`}
          />
          Atualizar
        </Button>
      </div>

      {/* Linha 1: Health + saldo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground">
                Saúde Asaas
              </div>
              {health.ok ? (
                <Badge className="bg-green-100 text-green-900 border-green-300">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                </Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-900 border-amber-300">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Atenção
                </Badge>
              )}
            </div>
            {health.accountStatus ? (
              <div className="text-xs space-y-1">
                <Row
                  label="Status geral"
                  value={
                    <Badge className={statusBadgeColor(health.accountStatus.general)}>
                      {health.accountStatus.general}
                    </Badge>
                  }
                />
                <Row label="Comercial" value={health.accountStatus.commercialInfo} />
                <Row label="Conta bancária" value={health.accountStatus.bankAccountInfo} />
                <Row label="Documentação" value={health.accountStatus.documentation} />
              </div>
            ) : (
              <p className="text-xs text-red-600">
                {health.accountStatusError ?? "Subconta Asaas não encontrada"}
              </p>
            )}
            <div className="text-xs text-muted-foreground pt-1 border-t">
              Ambiente: <span className="font-mono">{health.asaasEnv}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Wallet className="h-4 w-4" /> Saldo Asaas
              </div>
              <span className="text-xs text-muted-foreground">
                Atualizado{" "}
                {fmtRelativeMinutes(
                  health.lastWebhook?.ageMinutes ?? null
                )}
              </span>
            </div>
            {health.balance ? (
              <div className="text-2xl font-semibold">
                {fmtBRL(health.balance.total)}
              </div>
            ) : (
              <div className="text-sm text-red-600">
                {health.balanceError ?? "Indisponível"}
              </div>
            )}
            {health.balance && (
              <div className="text-xs space-y-1">
                <Row label="Disponível" value={fmtBRL(health.balance.available)} />
                <Row label="Bloqueado" value={fmtBRL(health.balance.blocked)} />
                <Row label="Pendente" value={fmtBRL(health.balance.pending)} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Linha 2: KPIs principais (4 cards) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="h-3 w-3" /> Webhooks (30d)
            </div>
            <div className="text-2xl font-semibold mt-1">
              {data.webhooks.total}
            </div>
            <div className="text-xs mt-1">
              {data.webhooks.successRate !== null && (
                <span
                  className={
                    data.webhooks.successRate >= 99
                      ? "text-green-700"
                      : data.webhooks.successRate >= 95
                        ? "text-amber-700"
                        : "text-red-700"
                  }
                >
                  {data.webhooks.successRate}% sucesso
                </span>
              )}
              {(data.webhooks.withError > 0 || data.webhooks.unprocessed > 0) && (
                <span className="text-red-700 ml-1">
                  · {data.webhooks.withError} erro
                  {data.webhooks.unprocessed > 0 &&
                    ` · ${data.webhooks.unprocessed} órfão`}
                </span>
              )}
            </div>
            {data.webhooks.avgLatencyMs > 0 && (
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3" /> ~{data.webhooks.avgLatencyMs}ms
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Send className="h-3 w-3" /> Transferências
            </div>
            <div className="text-2xl font-semibold mt-1">
              {data.transfers.byStatus.reduce((s, x) => s + x.count, 0)}
            </div>
            <div className="text-xs flex flex-wrap gap-1 mt-1">
              {data.transfers.byStatus.map((t) => (
                <Badge
                  key={t.status}
                  className={`${statusBadgeColor(t.status)} text-[10px]`}
                  variant="outline"
                >
                  {t.status} {t.count}
                </Badge>
              ))}
            </div>
            {data.transfers.failedSplitsRetryable > 0 && (
              <div className="text-xs text-red-700 mt-1">
                {data.transfers.failedSplitsRetryable} split(s) com retry
                disponível
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <FileText className="h-3 w-3" /> Cobranças pendentes
            </div>
            <div className="text-2xl font-semibold mt-1">
              {data.charges.pending}
            </div>
            {data.charges.overdue > 0 && (
              <div className="text-xs text-red-700 mt-1">
                {data.charges.overdue} vencida(s)
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Recebido (30d)
            </div>
            <div className="text-2xl font-semibold mt-1 text-green-700">
              {data.charges.recentlyReceived}
            </div>
            <div className="text-xs text-muted-foreground mt-1">cobrança(s)</div>
          </CardContent>
        </Card>
      </div>

      {/* Erros recentes de webhook */}
      {data.webhooks.recentErrors.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-1">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Erros recentes de webhook
              </h2>
              <Badge variant="outline" className="text-xs">
                {data.webhooks.recentErrors.length} de últimos 7d
              </Badge>
            </div>
            <ul className="space-y-2">
              {data.webhooks.recentErrors.map((e) => (
                <li key={e.eventId} className="text-xs border rounded p-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="font-mono">{e.eventId}</span>
                    <span className="text-muted-foreground">
                      {new Date(e.receivedAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px] mt-1">
                    {e.event}
                  </Badge>
                  <div className="text-red-700 mt-1 break-all">{e.error}</div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-3">
              O cron <code>/api/cron/webhooks/retry-orphaned</code> roda
              diariamente às 3am UTC e tenta reprocessar.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Eventos por tipo */}
      {data.webhooks.byEvent.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-3">
              Webhooks por tipo (30d)
            </h2>
            <div className="space-y-1">
              {data.webhooks.byEvent
                .sort((a, b) => b.count - a.count)
                .map((e) => (
                  <div
                    key={e.event}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-mono text-xs">{e.event}</span>
                    <Badge variant="outline" className="text-xs">
                      {e.count}
                    </Badge>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
