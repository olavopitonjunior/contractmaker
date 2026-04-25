"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  AlertTriangle,
  PieChart as PieIcon,
  Users,
} from "lucide-react";
import { maskCpfCnpj } from "@/lib/security/pii";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-amber-500",
  CONFIRMED: "bg-blue-500",
  RECEIVED: "bg-green-500",
  RECEIVED_IN_CASH: "bg-green-400",
  OVERDUE: "bg-red-500",
  REFUNDED: "bg-gray-500",
  CANCELLED: "bg-gray-400",
  CHARGEBACK: "bg-red-700",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Aguardando",
  CONFIRMED: "Confirmadas",
  RECEIVED: "Recebidas",
  RECEIVED_IN_CASH: "Dinheiro",
  OVERDUE: "Vencidas",
  REFUNDED: "Estornadas",
  CANCELLED: "Canceladas",
  CHARGEBACK: "Chargeback",
};

const VALID_TABS = ["receivables", "aging", "cashflow", "defaulters"] as const;
type ReportTab = (typeof VALID_TABS)[number];

export default function RelatoriosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: ReportTab = VALID_TABS.includes(rawTab as ReportTab)
    ? (rawTab as ReportTab)
    : "receivables";

  function handleTabChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "receivables") params.delete("tab");
    else params.set("tab", v);
    const qs = params.toString();
    router.replace(`/financeiro/relatorios${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Análise de recebíveis, envelhecimento, fluxo de caixa e inadimplência.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="receivables">
            <PieIcon className="h-4 w-4 mr-1" /> Recebíveis
          </TabsTrigger>
          <TabsTrigger value="aging">
            <AlertTriangle className="h-4 w-4 mr-1" /> Aging
          </TabsTrigger>
          <TabsTrigger value="cashflow">
            <TrendingUp className="h-4 w-4 mr-1" /> Cashflow
          </TabsTrigger>
          <TabsTrigger value="defaulters">
            <Users className="h-4 w-4 mr-1" /> Inadimplência
          </TabsTrigger>
        </TabsList>

        <TabsContent value="receivables" className="mt-4">
          <ReceivablesReport />
        </TabsContent>
        <TabsContent value="aging" className="mt-4">
          <AgingReport />
        </TabsContent>
        <TabsContent value="cashflow" className="mt-4">
          <CashflowReport />
        </TabsContent>
        <TabsContent value="defaulters" className="mt-4">
          <DefaultersReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReceivablesReport() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/financeiro/reports?type=receivables", { credentials: "include" })
      .then((r) => r.json())
      .then(setData);
  }, []);
  if (!data) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  const total = (data.summary as any[]).reduce((s, r) => s + r.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Distribuição de recebíveis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-3xl font-bold">{fmtBRL(total)}</div>
        <div className="space-y-2">
          {(data.summary as any[]).map((r) => {
            const pct = total > 0 ? (r.value / total) * 100 : 0;
            return (
              <div key={r.status}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-3 w-3 rounded-full ${STATUS_COLOR[r.status] ?? "bg-gray-400"}`}
                    />
                    <span>{STATUS_LABEL[r.status] ?? r.status}</span>
                    <span className="text-xs text-muted-foreground">
                      ({r.count})
                    </span>
                  </div>
                  <span className="font-medium">{fmtBRL(r.value)}</span>
                </div>
                <div className="h-2 bg-muted rounded overflow-hidden">
                  <div
                    className={`h-full ${STATUS_COLOR[r.status] ?? "bg-gray-400"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function AgingReport() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/financeiro/reports?type=aging", { credentials: "include" })
      .then((r) => r.json())
      .then(setData);
  }, []);
  if (!data) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  const buckets = data.buckets as Record<string, { count: number; value: number; charges: any[] }>;
  const max = Math.max(...Object.values(buckets).map((b) => b.value), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Envelhecimento (Aging) — {data.totalCount} cobranças vencidas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-3xl font-bold text-red-700">
          {fmtBRL(data.totalOverdue)}
        </div>
        <div className="space-y-3">
          {Object.entries(buckets).map(([label, b]) => (
            <div key={label}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium">{label} dias</span>
                <span>
                  {fmtBRL(b.value)} ({b.count})
                </span>
              </div>
              <div className="h-3 bg-muted rounded overflow-hidden">
                <div
                  className="h-full bg-red-500"
                  style={{ width: `${(b.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CashflowReport() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/financeiro/reports?type=cashflow", { credentials: "include" })
      .then((r) => r.json())
      .then(setData);
  }, []);
  if (!data) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  const months = data.months as { key: string; label: string; received: number; expected: number }[];
  const max = Math.max(...months.map((m) => Math.max(m.received, m.expected)), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fluxo de caixa — últimos 6 meses</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-6 gap-2 items-end h-[200px]">
          {months.map((m) => (
            <div key={m.key} className="flex flex-col justify-end items-center gap-1">
              <div className="w-full flex items-end gap-1 justify-center" style={{ height: "160px" }}>
                <div
                  className="w-4 bg-green-500 rounded-t relative group"
                  style={{ height: `${(m.received / max) * 100}%` }}
                  title={`Recebido: ${fmtBRL(m.received)}`}
                />
                <div
                  className="w-4 bg-blue-300 rounded-t"
                  style={{ height: `${(m.expected / max) * 100}%` }}
                  title={`Previsto: ${fmtBRL(m.expected)}`}
                />
              </div>
              <div className="text-xs text-muted-foreground">{m.label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs mt-4">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500" /> Recebido
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-300" /> Previsto
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DefaultersReport() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/financeiro/reports?type=defaulters", { credentials: "include" })
      .then((r) => r.json())
      .then(setData);
  }, []);
  if (!data) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Top 10 inadimplentes
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {(data.defaulters as any[]).length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhum cliente inadimplente 🎉
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Valor vencido</th>
                <th className="px-3 py-2 text-right">Cobranças</th>
              </tr>
            </thead>
            <tbody>
              {(data.defaulters as any[]).map((d, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{d.customer?.name ?? "—"}</div>
                    {d.customer?.cpfCnpj && (
                      <div className="text-xs text-muted-foreground">
                        {maskCpfCnpj(d.customer.cpfCnpj)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-red-700">
                    {fmtBRL(d.overdueValue)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Badge variant="outline">{d.overdueCount}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
