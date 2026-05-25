"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Search, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { maskCpfCnpj } from "@/lib/security/pii";
import { useAccountIdParam } from "@/hooks/useAccountIdParam";

interface ChargeRow {
  id: string;
  asaasPaymentId: string;
  value: number;
  netValue: number | null;
  billingType: "PIX" | "BOLETO";
  kind: string;
  status: string;
  description: string | null;
  currentDueDate: string;
  paidAt: string | null;
  customer: { id: string; name: string; cpfCnpj: string; email: string | null } | null;
  deal: { id: string; title: string } | null;
  createdAt: string;
}

// Cores via tokens semânticos do DS (dark-safe + on-brand) em vez de
// classes Tailwind cruas. success=recebida, warning=pendente/risco,
// info=confirmada, destructive=vencida/chargeback, muted=encerrada/neutra.
const SEMANTIC = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/30 bg-info/10 text-info",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-transparent bg-muted text-muted-foreground",
} as const;
const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  PENDING: { text: "Aguardando", color: SEMANTIC.warning },
  CONFIRMED: { text: "Confirmada", color: SEMANTIC.info },
  RECEIVED: { text: "Recebida", color: SEMANTIC.success },
  RECEIVED_IN_CASH: { text: "Dinheiro", color: SEMANTIC.success },
  OVERDUE: { text: "Vencida", color: SEMANTIC.danger },
  REFUNDED: { text: "Estornada", color: SEMANTIC.muted },
  REFUND_PENDING: { text: "Estorno em andamento", color: SEMANTIC.warning },
  CANCELLED: { text: "Cancelada", color: SEMANTIC.muted },
  CHARGEBACK: { text: "Chargeback", color: SEMANTIC.danger },
  DUNNING: { text: "Em negativação", color: SEMANTIC.warning },
  RISK_ANALYSIS: { text: "Análise de risco", color: SEMANTIC.warning },
};

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export interface ChargesListProps {
  hideNewButton?: boolean;
  /** Quando presente, fixa o filtro de dealId */
  dealId?: string;
}

export function ChargesList({ hideNewButton, dealId }: ChargesListProps) {
  const accountId = useAccountIdParam();
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [billingFilter, setBillingFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, statusFilter, billingFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      params.set("limit", String(limit));
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (billingFilter !== "all") params.set("billingType", billingFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (dealId) params.set("dealId", dealId);
      if (accountId) params.set("accountId", accountId);

      const res = await fetch(`/api/financeiro/charges?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao listar cobranças");
        return;
      }
      setRows(data.rows);
      setTotal(data.total);
      setStatusCounts(data.statusCounts);
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter, billingFilter, debouncedSearch, dealId, accountId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Nome, CPF, descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="PENDING">Aguardando</SelectItem>
            <SelectItem value="CONFIRMED">Confirmadas</SelectItem>
            <SelectItem value="RECEIVED">Recebidas</SelectItem>
            <SelectItem value="OVERDUE">Vencidas</SelectItem>
            <SelectItem value="CANCELLED">Canceladas</SelectItem>
            <SelectItem value="REFUNDED">Estornadas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={billingFilter} onValueChange={(v) => { setBillingFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Método" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="PIX">PIX</SelectItem>
            <SelectItem value="BOLETO">Boleto</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={load} title="Atualizar">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        {!hideNewButton && (
          <Button asChild>
            <Link href="/financeiro/cobrancas/nova">
              <Plus className="h-4 w-4 mr-1" /> Nova
            </Link>
          </Button>
        )}
      </div>

      {/* Chips de status — sempre mostra os principais, contagens vindas do server */}
      <div className="flex items-center gap-1 flex-wrap text-xs">
        <button
          onClick={() => setStatusFilter("all")}
          className={`px-2 py-1 rounded border ${
            statusFilter === "all" ? "bg-primary text-primary-foreground" : ""
          }`}
        >
          Todas ({total})
        </button>
        {(["PENDING", "OVERDUE", "CONFIRMED", "RECEIVED", "CANCELLED", "REFUNDED"] as const).map(
          (st) => {
            const count = statusCounts[st] ?? 0;
            const label = STATUS_LABEL[st]?.text ?? st;
            const active = statusFilter === st;
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(active ? "all" : st)}
                className={`px-2 py-1 rounded border transition-colors ${
                  active ? "bg-primary text-primary-foreground" : STATUS_LABEL[st]?.color ?? ""
                } ${count === 0 && !active ? "opacity-50" : ""}`}
              >
                {label} ({count})
              </button>
            );
          }
        )}
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Pagador</th>
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Vencto</th>
                <th className="px-3 py-2">Método</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Origem</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhuma cobrança encontrada
                  </td>
                </tr>
              )}
              {rows.map((c) => {
                const status = STATUS_LABEL[c.status] ?? { text: c.status, color: "" };
                return (
                  <tr key={c.id} className="border-t hover:bg-muted/50">
                    <td className="px-3 py-2">
                      <Link href={`/financeiro/cobrancas/${c.id}`} className="font-medium hover:underline">
                        {c.customer?.name ?? "—"}
                      </Link>
                      {c.customer && (
                        <div className="text-xs text-muted-foreground">
                          {maskCpfCnpj(c.customer.cpfCnpj)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium">{fmtBRL(c.value)}</td>
                    <td className="px-3 py-2">{fmtDate(c.currentDueDate)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">
                        {c.billingType}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={status.color}>
                        {status.text}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.deal ? (
                        <Link href={`/deals/${c.deal.id}`} className="hover:underline">
                          {c.deal.title}
                        </Link>
                      ) : (
                        "Avulsa"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Paginação */}
      {total > limit && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {offset + 1}–{Math.min(offset + limit, total)} de {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
