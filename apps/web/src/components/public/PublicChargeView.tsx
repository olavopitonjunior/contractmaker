"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Copy,
  Check,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface PublicChargeData {
  charge: {
    id: string;
    value: number;
    billingType: "PIX" | "BOLETO";
    status: string;
    description: string | null;
    currentDueDate: string;
    paidAt: string | null;
    invoiceUrl: string | null;
    bankSlipUrl: string | null;
    identificationField: string | null;
    pixQrCodePayload: string | null;
    pixQrCodeImage: string | null;
  };
  payer: { firstName: string; cpfCnpjMasked: string } | null;
  brand: {
    displayName: string;
    logoUrl: string | null;
    primaryColor: string;
    supportEmail: string | null;
    supportPhone: string | null;
  };
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success("Copiado!");
        setTimeout(() => setCopied(false), 2000);
      }}
      className="w-full"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4 mr-2" /> Copiado
        </>
      ) : (
        <>
          <Copy className="h-4 w-4 mr-2" /> {label}
        </>
      )}
    </Button>
  );
}

const STATUS_UI: Record<
  string,
  {
    text: string;
    icon: React.ComponentType<{ className?: string }>;
    bg: string;
    text_color: string;
  }
> = {
  PENDING: {
    text: "Aguardando pagamento",
    icon: Clock,
    bg: "bg-amber-50",
    text_color: "text-amber-900",
  },
  CONFIRMED: {
    text: "Pagamento confirmado",
    icon: CheckCircle2,
    bg: "bg-blue-50",
    text_color: "text-blue-900",
  },
  RECEIVED: {
    text: "Pagamento concluído",
    icon: CheckCircle2,
    bg: "bg-green-50",
    text_color: "text-green-900",
  },
  RECEIVED_IN_CASH: {
    text: "Pago em dinheiro",
    icon: CheckCircle2,
    bg: "bg-green-50",
    text_color: "text-green-900",
  },
  OVERDUE: {
    text: "Vencida",
    icon: AlertTriangle,
    bg: "bg-red-50",
    text_color: "text-red-900",
  },
  REFUNDED: {
    text: "Estornada",
    icon: XCircle,
    bg: "bg-gray-100",
    text_color: "text-gray-700",
  },
};

export function PublicChargeView({ initialToken }: { initialToken: string }) {
  const [data, setData] = useState<PublicChargeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/public/charges/${initialToken}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Falha ao carregar");
        return;
      }
      setData(body);
      setError(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Poll every 10s para status update
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Link inválido</h1>
          <p className="text-sm text-muted-foreground">
            Este link de pagamento não existe ou expirou.
          </p>
        </div>
      </div>
    );
  }

  const { charge, payer, brand } = data;
  const statusUi = STATUS_UI[charge.status] ?? STATUS_UI.PENDING;
  const StatusIcon = statusUi.icon;
  const isActive = ["PENDING", "OVERDUE"].includes(charge.status);
  const isPaid = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(charge.status);

  return (
    <div className="min-h-screen bg-muted">
      {/* Header branded */}
      <header
        className="px-4 py-4"
        style={{ backgroundColor: brand.primaryColor, color: "white" }}
      >
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={brand.displayName}
                className="h-10 bg-white rounded px-2 py-1"
              />
            ) : (
              <span className="font-semibold text-lg">{brand.displayName}</span>
            )}
            {brand.logoUrl && <span className="font-medium">{brand.displayName}</span>}
          </div>
          {brand.supportPhone && (
            <span className="text-xs opacity-90 hidden sm:block">
              Suporte: {brand.supportPhone}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* Saudação */}
        <div className="text-center py-4">
          <h1 className="text-xl sm:text-2xl font-semibold">
            Olá{payer ? `, ${payer.firstName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {charge.description ?? "Aqui está sua cobrança."}
          </p>
        </div>

        {/* Valor + status */}
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <div className="text-4xl sm:text-5xl font-bold tracking-tight">
              {fmtBRL(charge.value)}
            </div>
            <div className="text-sm text-muted-foreground">
              Vencimento: {fmtDate(charge.currentDueDate)}
            </div>
            <div
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm ${statusUi.bg} ${statusUi.text_color}`}
              role="status"
              aria-live="polite"
            >
              <StatusIcon className="h-4 w-4" />
              {statusUi.text}
            </div>
          </CardContent>
        </Card>

        {/* PIX card */}
        {isActive && charge.billingType === "PIX" && charge.pixQrCodePayload && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center">
                <div className="font-semibold text-lg mb-3">Pagar com PIX</div>
                {charge.pixQrCodeImage && (
                  <Image
                    src={`data:image/png;base64,${charge.pixQrCodeImage}`}
                    alt="QR Code PIX"
                    width={260}
                    height={260}
                    unoptimized
                    className="border rounded bg-white mx-auto"
                  />
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Escaneie o QR ou copie o código abaixo no seu app bancário.
                </p>
              </div>
              <div>
                <div className="text-xs font-mono bg-muted p-2 rounded break-all max-h-24 overflow-y-auto">
                  {charge.pixQrCodePayload}
                </div>
              </div>
              <CopyButton value={charge.pixQrCodePayload} label="Copiar código PIX" />
              <p className="text-xs text-muted-foreground text-center">
                Aprovação em segundos após o pagamento
              </p>
            </CardContent>
          </Card>
        )}

        {/* Boleto card */}
        {isActive && charge.billingType === "BOLETO" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center">
                <div className="font-semibold text-lg mb-3">Pagar com boleto</div>
              </div>
              {charge.identificationField && (
                <>
                  <div className="text-xs text-muted-foreground">Linha digitável:</div>
                  <div className="text-sm font-mono bg-muted p-3 rounded break-all">
                    {charge.identificationField}
                  </div>
                  <CopyButton
                    value={charge.identificationField}
                    label="Copiar linha digitável"
                  />
                </>
              )}
              {charge.bankSlipUrl && (
                <Button asChild className="w-full">
                  <a
                    href={charge.bankSlipUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Baixar boleto em PDF
                  </a>
                </Button>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Aprovação em 1-2 dias úteis após o pagamento
              </p>
            </CardContent>
          </Card>
        )}

        {/* Paid */}
        {isPaid && (
          <Card className="border-green-300 bg-green-50">
            <CardContent className="pt-6 text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
              <div className="font-semibold text-green-900">
                Pagamento recebido com sucesso
              </div>
              {charge.paidAt && (
                <p className="text-sm text-green-800">
                  Confirmado em {fmtDate(charge.paidAt)}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Detalhes + suporte */}
        <Card>
          <CardContent className="pt-6 space-y-2 text-sm">
            {charge.description && (
              <div>
                <span className="text-muted-foreground">Descrição:</span>{" "}
                {charge.description}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Beneficiário:</span>{" "}
              {brand.displayName}
            </div>
            {payer && (
              <div>
                <span className="text-muted-foreground">Pagador:</span>{" "}
                {payer.firstName} ({payer.cpfCnpjMasked})
              </div>
            )}
            {isActive && (
              <p className="text-xs text-muted-foreground mt-2">
                ⚠ Após o vencimento, aplicam-se multa e juros conforme contrato.
              </p>
            )}
            {charge.invoiceUrl && (
              <div className="pt-2">
                <Button variant="outline" size="sm" asChild className="w-full">
                  <a href={charge.invoiceUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Abrir fatura completa
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Support */}
        {(brand.supportEmail || brand.supportPhone) && (
          <Card>
            <CardContent className="pt-6 text-sm">
              <div className="font-medium mb-2">Precisa de ajuda?</div>
              <div className="space-y-1 text-muted-foreground">
                {brand.supportEmail && (
                  <div>📧 {brand.supportEmail}</div>
                )}
                {brand.supportPhone && <div>📱 {brand.supportPhone}</div>}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar status
          </Button>
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-2">
          <ShieldCheck className="h-3 w-3" />
          Processado com segurança pelo Contractmaker + Asaas
        </div>
      </footer>
    </div>
  );
}
