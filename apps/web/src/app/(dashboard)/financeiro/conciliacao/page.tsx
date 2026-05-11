"use client";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, CheckCircle2, Ban, Link2 } from "lucide-react";
import { useAccountIdParam } from "@/hooks/useAccountIdParam";

interface Recon {
  id: string;
  type: string;
  value: number;
  date: string;
  description: string | null;
  asaasPaymentId: string | null;
  matchedChargeId: string | null;
  status: string;
  matchedCharge: { id: string; asaasPaymentId: string; customer: { name: string } | null } | null;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

const TYPE_LABEL: Record<string, string> = {
  PAYMENT_RECEIVED: "Pagamento recebido",
  PAYMENT_FEE: "Taxa Asaas",
  REFUND: "Estorno",
  TRANSFER: "Transferência",
  CHARGEBACK: "Chargeback",
};

const STATUS_UI: Record<string, { color: string; label: string }> = {
  pending: { color: "bg-amber-100 text-amber-900", label: "Pendente" },
  matched: { color: "bg-green-100 text-green-900", label: "Auto" },
  manual: { color: "bg-blue-100 text-blue-900", label: "Manual" },
  ignored: { color: "bg-gray-100 text-gray-700", label: "Ignorado" },
};

export default function ConciliacaoPage() {
  const accountId = useAccountIdParam();
  const [rows, setRows] = useState<Recon[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status });
      if (accountId) params.set("accountId", accountId);
      const res = await fetch(`/api/financeiro/reconciliation?${params}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
        setCounts(data.counts);
      }
    } finally {
      setLoading(false);
    }
  }, [status, accountId]);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      // default: últimos 30 dias
      const today = new Date();
      const thirtyAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const res = await fetch("/api/financeiro/reconciliation/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accountId: accountId || undefined,
          startDate: thirtyAgo.toISOString().slice(0, 10),
          finishDate: today.toISOString().slice(0, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao sincronizar");
        return;
      }
      if (data.fetched === 0) {
        toast.info("Nenhum lançamento novo desde a última sincronização");
      } else {
        toast.success(
          `Sincronizado: ${data.fetched} lançamento${data.fetched !== 1 ? "s" : ""}, ${data.autoMatched} auto-conciliado${data.autoMatched !== 1 ? "s" : ""}`
        );
      }
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function ignore(id: string) {
    if (!confirm("Ignorar este lançamento?")) return;
    const res = await fetch(`/api/financeiro/reconciliation/${id}/ignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    if (res.ok) {
      toast.success("Ignorado");
      await load();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Conciliação bancária</h1>
          <p className="text-sm text-muted-foreground">
            Cruze o extrato Asaas com suas cobranças locais.
          </p>
        </div>
        <Button onClick={sync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando..." : "Sincronizar extrato (30d)"}
        </Button>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-4 gap-2">
        {(["pending", "matched", "manual", "ignored"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`border rounded p-3 text-left transition ${
              status === s ? "border-primary bg-primary/5" : ""
            }`}
          >
            <div className="text-xs text-muted-foreground">
              {STATUS_UI[s].label}
            </div>
            <div className="text-2xl font-bold">{counts[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Carregando...
            </p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhum lançamento {STATUS_UI[status]?.label.toLowerCase()}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Match</th>
                  <th className="px-3 py-2 w-0">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 text-xs">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2">
                      <div>{TYPE_LABEL[r.type] ?? r.type}</div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${
                        r.value < 0 ? "text-red-700" : "text-green-700"
                      }`}
                    >
                      {r.value < 0 ? "-" : "+"}
                      {fmtBRL(Math.abs(r.value))}
                    </td>
                    <td className="px-3 py-2">
                      {r.matchedCharge ? (
                        <div className="flex items-center gap-1 text-xs">
                          <CheckCircle2 className="h-3 w-3 text-green-600" />
                          {r.matchedCharge.customer?.name ?? r.matchedCharge.asaasPaymentId}
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Sem match
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "pending" && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Ignorar"
                            onClick={() => ignore(r.id)}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
