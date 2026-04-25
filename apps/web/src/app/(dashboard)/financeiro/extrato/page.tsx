"use client";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, Download, TrendingUp, TrendingDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Transaction {
  id?: string;
  type: string;
  value: number;
  netValue?: number;
  date: string;
  description?: string | null;
  paymentId?: string | null;
}

interface BalanceData {
  balance: number | null;
  blockedBalance: number;
  pendingBalance: number;
  accountStatus: string;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

const TYPE_LABEL: Record<string, string> = {
  PAYMENT_RECEIVED: "Pagamento recebido",
  PAYMENT_FEE: "Taxa Asaas",
  PAYMENT_OVERPAID: "Pagamento em excesso",
  REFUND: "Estorno",
  REFUND_FEE: "Taxa de estorno",
  TRANSFER: "Transferência",
  TRANSFER_FEE: "Taxa de transferência",
  CHARGEBACK: "Chargeback",
  ANTICIPATION: "Antecipação",
};

export default function ExtratoPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [startDate, setStartDate] = useState(monthAgo);
  const [finishDate, setFinishDate] = useState(today);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, stmtRes] = await Promise.all([
        fetch("/api/financeiro/balance", { credentials: "include" }),
        fetch(
          `/api/financeiro/statement?startDate=${startDate}&finishDate=${finishDate}&limit=100`,
          { credentials: "include" }
        ),
      ]);
      const bal = await balRes.json();
      const stmt = await stmtRes.json();
      if (balRes.ok) setBalance(bal);
      if (stmtRes.ok) {
        setTransactions(stmt.data ?? []);
        setTotalIn(stmt.totalIn ?? 0);
        setTotalOut(stmt.totalOut ?? 0);
      }
    } catch (err) {
      toast.error("Falha ao carregar extrato");
    } finally {
      setLoading(false);
    }
  }, [startDate, finishDate]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (transactions.length === 0) {
      toast.error("Nada para exportar");
      return;
    }
    const header = "Data,Tipo,Descrição,Valor,Saldo\n";
    const rows = transactions
      .map((t) => {
        const desc = (t.description ?? TYPE_LABEL[t.type] ?? t.type)
          .replace(/"/g, '""');
        return `"${t.date}","${t.type}","${desc}","${t.value.toFixed(2)}",""`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extrato_${startDate}_${finishDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Extrato</h1>
        <p className="text-sm text-muted-foreground">
          Saldo e movimentações da sua subconta Asaas.
        </p>
      </div>

      {/* Saldo cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Saldo disponível
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {balance?.balance != null ? fmtBRL(balance.balance) : "—"}
            </div>
            {balance?.accountStatus && balance.accountStatus !== "APPROVED" && (
              <p className="text-xs text-amber-700 mt-1">
                Conta: {balance.accountStatus}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Entradas (período)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-green-700 flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {fmtBRL(totalIn)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Saídas (período)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-red-700 flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              {fmtBRL(totalOut)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <Label htmlFor="start" className="text-xs">
            De
          </Label>
          <Input
            id="start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div>
          <Label htmlFor="finish" className="text-xs">
            Até
          </Label>
          <Input
            id="finish"
            type="date"
            value={finishDate}
            onChange={(e) => setFinishDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={load}
                aria-label="Recarregar extrato"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recarregar extrato</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant="outline" onClick={exportCsv} aria-label="Exportar CSV">
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {loading && transactions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && transactions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhuma movimentação no período
                  </td>
                </tr>
              )}
              {transactions.map((t, i) => {
                const isNeg = t.value < 0;
                return (
                  <tr key={t.id ?? i} className="border-t">
                    <td className="px-3 py-2">{fmtDate(t.date)}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-mono">
                        {TYPE_LABEL[t.type] ?? t.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[300px] truncate">
                      {t.description ?? "—"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${
                        isNeg ? "text-red-700" : "text-green-700"
                      }`}
                    >
                      {isNeg ? "-" : "+"}
                      {fmtBRL(Math.abs(t.value))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
