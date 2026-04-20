"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check, Download, ExternalLink, RefreshCw } from "lucide-react";

export interface Charge {
  id: string;
  asaasPaymentId: string;
  value: number;
  netValue?: number | null;
  billingType: "PIX" | "BOLETO";
  status: string;
  asaasStatus: string;
  description: string | null;
  currentDueDate: string;
  paidAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  identificationField: string | null;
  pixQrCodePayload: string | null;
  pixQrCodeImage: string | null;
  customer: { name: string; cpfCnpj: string; email: string | null } | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, { text: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
  PENDING: { text: "Aguardando", variant: "outline", color: "bg-amber-100 text-amber-900 border-amber-300" },
  CONFIRMED: { text: "Confirmado", variant: "default", color: "bg-blue-100 text-blue-900 border-blue-300" },
  RECEIVED: { text: "Recebido", variant: "default", color: "bg-green-100 text-green-900 border-green-300" },
  OVERDUE: { text: "Vencido", variant: "destructive", color: "bg-red-100 text-red-900 border-red-300" },
  REFUNDED: { text: "Estornado", variant: "secondary", color: "bg-gray-100 text-gray-700" },
  RECEIVED_IN_CASH: { text: "Baixa manual", variant: "secondary", color: "bg-gray-100 text-gray-700" },
  CANCELLED: { text: "Cancelado", variant: "secondary", color: "bg-gray-100 text-gray-700" },
  CHARGEBACK: { text: "Chargeback", variant: "destructive", color: "bg-red-100 text-red-900 border-red-300" },
  DUNNING: { text: "Em negativação", variant: "outline", color: "bg-amber-100 text-amber-900" },
  RISK_ANALYSIS: { text: "Análise de risco", variant: "outline", color: "bg-amber-100 text-amber-900" },
};

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success("Copiado");
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
      {label}
    </Button>
  );
}

export function CommissionChargeList({ dealId }: { dealId: string }) {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/commission-charges`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) setCharges(data.charges);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Poll a cada 15s para status updates
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  if (loading && charges.length === 0) {
    return <p className="text-sm text-muted-foreground">Carregando cobranças...</p>;
  }

  if (charges.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Nenhuma cobrança gerada ainda
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {charges.length} cobrança{charges.length > 1 ? "s" : ""}
        </p>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
        </Button>
      </div>

      {charges.map((c) => {
        const status = STATUS_LABEL[c.status] ?? STATUS_LABEL.PENDING;
        return (
          <Card key={c.id}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={status.color} variant="outline">
                      {status.text}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {c.asaasPaymentId}
                    </span>
                  </div>
                  <div className="text-lg font-semibold">{fmtBRL(c.value)}</div>
                  <div className="text-sm text-muted-foreground">
                    {c.billingType} • Vencimento {fmtDate(c.currentDueDate)}
                  </div>
                  {c.customer && (
                    <div className="text-sm mt-2">
                      <span className="text-muted-foreground">Pagador:</span>{" "}
                      {c.customer.name}
                    </div>
                  )}
                  {c.description && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {c.description}
                    </div>
                  )}
                </div>
              </div>

              {/* PIX QR */}
              {c.billingType === "PIX" && c.pixQrCodePayload && c.status === "PENDING" && (
                <div className="flex flex-col md:flex-row gap-4 p-3 border rounded-md bg-muted/30">
                  {c.pixQrCodeImage && (
                    <Image
                      src={`data:image/png;base64,${c.pixQrCodeImage}`}
                      alt="QR Code PIX"
                      width={160}
                      height={160}
                      unoptimized
                      className="border rounded bg-white"
                    />
                  )}
                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-medium">Código copia-e-cola</p>
                    <div className="text-xs font-mono bg-white p-2 rounded border break-all max-h-24 overflow-y-auto">
                      {c.pixQrCodePayload}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <CopyButton value={c.pixQrCodePayload} label="Copiar PIX" />
                      {c.invoiceUrl && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={c.invoiceUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4 mr-1" /> Fatura
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Boleto */}
              {c.billingType === "BOLETO" && c.status === "PENDING" && (
                <div className="space-y-2 p-3 border rounded-md bg-muted/30">
                  {c.identificationField && (
                    <>
                      <p className="text-sm font-medium">Linha digitável</p>
                      <div className="text-xs font-mono bg-white p-2 rounded border break-all">
                        {c.identificationField}
                      </div>
                    </>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {c.identificationField && (
                      <CopyButton value={c.identificationField} label="Copiar linha" />
                    )}
                    {c.bankSlipUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={c.bankSlipUrl} target="_blank" rel="noreferrer">
                          <Download className="h-4 w-4 mr-1" /> Boleto PDF
                        </a>
                      </Button>
                    )}
                    {c.invoiceUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={c.invoiceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" /> Fatura
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Recebido — resumo */}
              {c.status === "RECEIVED" && (
                <div className="p-3 border rounded-md bg-green-50 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Pago em {fmtDate(c.paidAt)}</span>
                    {c.netValue && (
                      <span className="font-medium">
                        Líquido: {fmtBRL(c.netValue)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
