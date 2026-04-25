"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail, Phone, Calendar, RefreshCw } from "lucide-react";
import { maskCpfCnpj } from "@/lib/security/pii";

interface ChargeItem {
  id: string;
  asaasPaymentId: string;
  value: number;
  status: string;
  billingType: string;
  description: string | null;
  currentDueDate: string;
  paidAt: string | null;
  createdAt: string;
  deal: { id: string; title: string } | null;
}

interface CustomerData {
  id: string;
  asaasId: string;
  name: string;
  cpfCnpj: string;
  email: string | null;
  mobilePhone: string | null;
  origin: string;
  createdAt: string;
  charges: ChargeItem[];
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-900 border-amber-300",
  CONFIRMED: "bg-blue-100 text-blue-900 border-blue-300",
  RECEIVED: "bg-green-100 text-green-900 border-green-300",
  RECEIVED_IN_CASH: "bg-green-50 text-green-800 border-green-200",
  OVERDUE: "bg-red-100 text-red-900 border-red-300",
  REFUNDED: "bg-gray-100 text-gray-700",
  REFUND_PENDING: "bg-amber-50 text-amber-800",
  CANCELLED: "bg-gray-100 text-gray-700",
};

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export function CustomerDetail({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/financeiro/customers/${customerId}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("Cliente não encontrado");
          router.replace("/financeiro/clientes");
          return;
        }
        toast.error(data.error ?? "Falha ao carregar");
        return;
      }
      setCustomer(data.customer);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (loading && !customer) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/financeiro/clientes">
            <ArrowLeft className="h-4 w-4 mr-1" /> Clientes
          </Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Carregando...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!customer) return null;

  const totalReceived = customer.charges
    .filter((c) => ["RECEIVED", "RECEIVED_IN_CASH", "CONFIRMED"].includes(c.status))
    .reduce((sum, c) => sum + Number(c.value), 0);
  const totalPending = customer.charges
    .filter((c) => ["PENDING", "OVERDUE"].includes(c.status))
    .reduce((sum, c) => sum + Number(c.value), 0);
  const originLabel =
    customer.origin === "deal_sync"
      ? "via deal"
      : customer.origin === "webhook_sync"
        ? "webhook"
        : "manual";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/financeiro/clientes">
            <ArrowLeft className="h-4 w-4 mr-1" /> Clientes
          </Link>
        </Button>
        <Button variant="outline" size="icon" onClick={load} aria-label="Recarregar">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold">{customer.name}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  {originLabel}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  Asaas: {customer.asaasId}
                </span>
              </div>
            </div>
          </div>

          <hr className="my-3" />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">CPF/CNPJ</div>
              <div className="font-mono">{maskCpfCnpj(customer.cpfCnpj)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs flex items-center gap-1">
                <Mail className="h-3 w-3" /> Email
              </div>
              <div className="truncate">{customer.email ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs flex items-center gap-1">
                <Phone className="h-3 w-3" /> Celular
              </div>
              <div>{customer.mobilePhone ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Criado em
              </div>
              <div>{fmtDateTime(customer.createdAt)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Cobranças</div>
            <div className="text-2xl font-semibold">{customer.charges.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Recebido</div>
            <div className="text-2xl font-semibold text-green-700">
              {fmtBRL(totalReceived)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">A receber</div>
            <div className="text-2xl font-semibold text-amber-700">
              {fmtBRL(totalPending)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-3 py-2 border-b bg-muted/30 text-sm font-medium">
            Cobranças deste cliente
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Vencimento</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Método</th>
              </tr>
            </thead>
            <tbody>
              {customer.charges.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-muted-foreground"
                  >
                    Nenhuma cobrança para este cliente ainda.
                  </td>
                </tr>
              )}
              {customer.charges.map((c) => (
                <tr
                  key={c.id}
                  className="border-t hover:bg-muted/50 cursor-pointer"
                  onClick={() => router.push(`/financeiro/cobrancas/${c.id}`)}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/financeiro/cobrancas/${c.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.description ?? c.deal?.title ?? "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{fmtDate(c.currentDueDate)}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {fmtBRL(Number(c.value))}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className={`text-xs ${STATUS_COLOR[c.status] ?? ""}`}
                    >
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-xs">
                      {c.billingType}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
