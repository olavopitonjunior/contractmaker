"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Copy,
  Check,
  ExternalLink,
  Download,
  MoreVertical,
  Calendar,
  Mail,
  Wallet,
  Undo2,
  Ban,
  RefreshCw,
  Link2,
} from "lucide-react";
import { maskCpfCnpj, maskEmail } from "@/lib/security/pii";

interface ChargeDetailData {
  id: string;
  asaasPaymentId: string;
  value: number;
  netValue: number | null;
  billingType: "PIX" | "BOLETO";
  kind: string;
  status: string;
  asaasStatus: string;
  description: string | null;
  originalDueDate: string;
  currentDueDate: string;
  paidAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  identificationField: string | null;
  pixQrCodePayload: string | null;
  pixQrCodeImage: string | null;
  splitJson: any;
  payerSnapshot: any;
  beneficiarySnapshot: any;
  customer: {
    id: string;
    name: string;
    cpfCnpj: string;
    email: string | null;
  } | null;
  deal: { id: string; title: string } | null;
  contract: { id: string; version: number } | null;
  createdAt: string;
}

interface EventEntry {
  id: string;
  asaasEventId: string;
  event: string;
  receivedAt: string;
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

function maskWallet(w: string) {
  if (!w) return "—";
  if (w.length <= 12) return w;
  return `${w.slice(0, 8)}…${w.slice(-4)}`;
}

function maskPixKey(key: string, type: string | null) {
  if (!key) return "—";
  if (type === "EMAIL" && key.includes("@")) {
    const [local, domain] = key.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (type === "CPF" || type === "CNPJ") {
    const digits = key.replace(/\D/g, "");
    return `***${digits.slice(-4)}`;
  }
  if (type === "PHONE") return `***${key.slice(-4)}`;
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}

function transferStatusLabel(status: string): string {
  switch (status) {
    case "PENDING_DISPATCH":
      return "Aguardando dispatch";
    case "PENDING":
      return "Em processamento";
    case "BANK_PROCESSING":
      return "Banco processando";
    case "DONE":
      return "Concluído";
    case "FAILED":
      return "Falha";
    case "CANCELLED":
      return "Cancelado";
    default:
      return status;
  }
}

function transferStatusColor(status: string): string {
  switch (status) {
    case "DONE":
      return "bg-green-100 text-green-900 border-green-300";
    case "PENDING":
    case "PENDING_DISPATCH":
    case "BANK_PROCESSING":
      return "bg-amber-100 text-amber-900 border-amber-300";
    case "FAILED":
      return "bg-red-100 text-red-900 border-red-300";
    default:
      return "bg-gray-100 text-gray-800 border-gray-300";
  }
}

function CopyBtn({ value, label }: { value: string; label: string }) {
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

interface ExternalSplitRow {
  recipientId: string;
  pixAddressKey: string;
  pixKeyType: string;
  ownerName: string;
  ownerCpfCnpj: string;
  label?: string;
  percentualValue?: number;
  fixedValue?: number;
}

interface SplitTransferRow {
  id: string;
  splitRecipientId: string | null;
  asaasTransferId: string | null;
  status: string;
  value: number;
  netValue: number | null;
  transferFee: number | null;
  pixAddressKey: string | null;
  pixKeyType: string | null;
  ownerName: string | null;
  effectiveDate: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface SplitsState {
  asaasSplits: Array<{ walletId: string; percentualValue?: number; fixedValue?: number }>;
  externalSplits: ExternalSplitRow[];
  transfers: SplitTransferRow[];
}

export function ChargeDetail({ chargeId }: { chargeId: string }) {
  const router = useRouter();
  const [charge, setCharge] = useState<ChargeDetailData | null>(null);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashDate, setCashDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [busy, setBusy] = useState(false);
  const [splits, setSplits] = useState<SplitsState | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/financeiro/charges/${chargeId}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao carregar");
        return;
      }
      setCharge(data.charge);
      setEvents(data.events);
      // edit form é preenchido só ao abrir o dialog (openEditDialog)
    } finally {
      setLoading(false);
    }
  }

  async function loadSplits() {
    try {
      const res = await fetch(`/api/financeiro/charges/${chargeId}/splits`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setSplits(data);
    } catch {
      /* silencioso — painel é só informativo */
    }
  }

  async function retrySplitTransfer(transferId: string) {
    setRetryingId(transferId);
    try {
      const res = await fetch(`/api/financeiro/transfers/${transferId}/retry`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.reason ?? data.error ?? "Falha ao reprocessar");
      } else {
        toast.success("Transferência reprocessada com sucesso");
      }
      await loadSplits();
    } finally {
      setRetryingId(null);
    }
  }

  useEffect(() => {
    load();
    loadSplits();
    const t = setInterval(() => {
      load();
      loadSplits();
    }, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeId]);

  async function cancel() {
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/charges/${chargeId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.description ?? data.error ?? "Falha");
        return;
      }
      toast.success("Cobrança cancelada");
      setCancelOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function openEditDialog() {
    if (!charge) return;
    setEditValue(charge.value.toString());
    setEditDueDate(charge.currentDueDate.slice(0, 10));
    setEditDescription(charge.description ?? "");
    setEditOpen(true);
  }

  async function refund() {
    if (!charge) return;
    if (!confirm(`Estornar ${fmtBRL(charge.value)}? O valor retorna ao pagador.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/charges/${chargeId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "ELEVATION_REQUIRED") {
          toast.error("Refund > R$10k exige confirmação extra — tente novamente após confirmar identidade");
        } else {
          toast.error(data.details?.[0]?.description ?? data.error ?? "Falha");
        }
        return;
      }
      toast.success("Estorno iniciado");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resendNotif() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/financeiro/charges/${chargeId}/resend-notification`,
        { method: "POST", credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.description ?? data.error ?? "Falha");
        return;
      }
      toast.success("Notificação reenviada");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!charge) return;
    const body: { value?: number; dueDate?: string; description?: string } = {};
    const valueNum = parseFloat(editValue);
    if (!Number.isNaN(valueNum) && valueNum !== charge.value) body.value = valueNum;
    if (editDueDate && editDueDate !== charge.currentDueDate.slice(0, 10)) {
      body.dueDate = editDueDate;
    }
    if (editDescription !== (charge.description ?? "")) {
      body.description = editDescription;
    }
    if (Object.keys(body).length === 0) {
      toast.info("Nada foi alterado");
      setEditOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/charges/${chargeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.details?.[0]?.description ?? data.error ?? "Falha");
        return;
      }
      toast.success("Cobrança atualizada");
      setEditOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function markCash() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/financeiro/charges/${chargeId}/mark-received-in-cash`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ paymentDate: cashDate }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.description ?? data.error ?? "Falha");
        return;
      }
      toast.success("Pagamento em dinheiro registrado");
      setCashOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading && !charge)
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!charge) return null;

  const isActive = ["PENDING", "OVERDUE"].includes(charge.status);
  const isRefundable = ["RECEIVED", "CONFIRMED"].includes(charge.status);
  const statusColor = STATUS_COLOR[charge.status] ?? "";

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/financeiro/cobrancas">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Link>
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={statusColor}>
                      {charge.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {charge.billingType}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {charge.asaasPaymentId}
                    </span>
                  </div>
                  <div className="text-3xl font-semibold">{fmtBRL(charge.value)}</div>
                  {charge.netValue && (
                    <div className="text-sm text-muted-foreground">
                      Líquido: {fmtBRL(charge.netValue)}
                    </div>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={busy}>
                      <MoreVertical className="h-4 w-4 mr-1" /> Ações
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {isActive && (
                      <>
                        <DropdownMenuItem onSelect={openEditDialog}>
                          <Calendar className="h-4 w-4 mr-2" /> Editar cobrança
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={resendNotif}>
                          <Mail className="h-4 w-4 mr-2" /> Reenviar notificação
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setCashOpen(true)}>
                          <Wallet className="h-4 w-4 mr-2" /> Marcar como pago em dinheiro
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => setCancelOpen(true)}
                          className="text-red-600"
                        >
                          <Ban className="h-4 w-4 mr-2" /> Cancelar cobrança
                        </DropdownMenuItem>
                      </>
                    )}
                    {isRefundable && (
                      <DropdownMenuItem onSelect={refund} className="text-red-600">
                        <Undo2 className="h-4 w-4 mr-2" /> Estornar
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <hr className="my-3" />

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Vencimento</div>
                  <div>{fmtDate(charge.currentDueDate)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Criada em</div>
                  <div>{fmtDate(charge.createdAt)}</div>
                </div>
                {charge.paidAt && (
                  <div>
                    <div className="text-muted-foreground text-xs">Pago em</div>
                    <div>{fmtDateTime(charge.paidAt)}</div>
                  </div>
                )}
                {charge.cancelledAt && (
                  <div>
                    <div className="text-muted-foreground text-xs">Cancelado em</div>
                    <div>{fmtDateTime(charge.cancelledAt)}</div>
                  </div>
                )}
                {charge.refundedAt && (
                  <div>
                    <div className="text-muted-foreground text-xs">Estornado em</div>
                    <div>{fmtDateTime(charge.refundedAt)}</div>
                  </div>
                )}
                {charge.description && (
                  <div className="col-span-2">
                    <div className="text-muted-foreground text-xs">Descrição</div>
                    <div>{charge.description}</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Dados do pagador */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pagador</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="font-medium">{charge.customer?.name ?? "—"}</div>
              {charge.customer?.cpfCnpj && (
                <div className="text-muted-foreground">
                  {maskCpfCnpj(charge.customer.cpfCnpj)}
                </div>
              )}
              {charge.customer?.email && (
                <div className="text-muted-foreground">
                  {maskEmail(charge.customer.email)}
                </div>
              )}
              {charge.payerSnapshot?.papel && (
                <Badge variant="outline" className="text-xs">
                  {charge.payerSnapshot.papel}
                </Badge>
              )}
            </CardContent>
          </Card>

          {/* Vinculação */}
          {(charge.deal || charge.contract) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Vinculação</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {charge.deal && (
                  <Link
                    href={`/deals/${charge.deal.id}`}
                    className="block hover:underline"
                  >
                    → Deal: {charge.deal.title}
                  </Link>
                )}
                {charge.contract && (
                  <div>→ Contrato v{charge.contract.version}</div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Splits — Fase 6: Asaas-nativo + PIX externo + dispatch status */}
          {splits &&
            (splits.asaasSplits.length > 0 || splits.externalSplits.length > 0) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Splits de pagamento</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {splits.asaasSplits.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        Splits Asaas-nativos (instantâneos)
                      </div>
                      <ul className="space-y-1">
                        {splits.asaasSplits.map((s, i) => (
                          <li
                            key={i}
                            className="flex items-center justify-between text-sm border rounded px-2 py-1"
                          >
                            <span className="font-mono text-xs">
                              {maskWallet(s.walletId)}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {s.percentualValue
                                ? `${s.percentualValue}%`
                                : fmtBRL(s.fixedValue ?? 0)}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {splits.externalSplits.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        PIX externos (dispatch automático após pagamento)
                      </div>
                      <ul className="space-y-2">
                        {splits.externalSplits.map((es) => {
                          const transfer = splits.transfers.find(
                            (t) => t.splitRecipientId === es.recipientId
                          );
                          return (
                            <li
                              key={es.recipientId}
                              className="border rounded p-2 space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium text-sm">
                                    {es.label ?? es.ownerName}
                                  </div>
                                  <div className="text-xs text-muted-foreground font-mono">
                                    {es.pixKeyType} ·{" "}
                                    {maskPixKey(es.pixAddressKey, es.pixKeyType)}
                                  </div>
                                </div>
                                <Badge variant="outline" className="text-xs">
                                  {es.percentualValue
                                    ? `${es.percentualValue}%`
                                    : fmtBRL(es.fixedValue ?? 0)}
                                </Badge>
                              </div>
                              {transfer ? (
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <Badge
                                      className={`text-xs ${transferStatusColor(transfer.status)}`}
                                    >
                                      {transferStatusLabel(transfer.status)}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground truncate">
                                      {transfer.status === "FAILED"
                                        ? transfer.failureReason ?? "Falha"
                                        : `${fmtBRL(transfer.value)} · ${transfer.asaasTransferId ?? "—"}`}
                                    </span>
                                  </div>
                                  {transfer.status === "FAILED" && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        retrySplitTransfer(transfer.id)
                                      }
                                      disabled={retryingId === transfer.id}
                                    >
                                      <RefreshCw
                                        className={`h-3 w-3 mr-1 ${
                                          retryingId === transfer.id
                                            ? "animate-spin"
                                            : ""
                                        }`}
                                      />
                                      Tentar novamente
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground italic">
                                  Aguardando confirmação do pagamento para
                                  disparar transferência.
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          {/* Timeline de eventos */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Histórico de eventos</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum evento Asaas processado ainda.
                </p>
              ) : (
                <ul className="space-y-1 text-xs font-mono">
                  {events.map((e) => (
                    <li key={e.id} className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {fmtDateTime(e.receivedAt)}
                      </span>
                      <span>{e.event}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna lateral: QR / boleto */}
        <div className="space-y-4">
          {charge.billingType === "PIX" && charge.pixQrCodePayload && isActive && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">PIX</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {charge.pixQrCodeImage && (
                  <Image
                    src={`data:image/png;base64,${charge.pixQrCodeImage}`}
                    alt="QR Code PIX"
                    width={220}
                    height={220}
                    unoptimized
                    className="border rounded bg-white mx-auto"
                  />
                )}
                <div className="text-xs font-mono bg-muted p-2 rounded break-all max-h-20 overflow-y-auto">
                  {charge.pixQrCodePayload}
                </div>
                <CopyBtn value={charge.pixQrCodePayload} label="Copiar código" />
              </CardContent>
            </Card>
          )}

          {charge.billingType === "BOLETO" && isActive && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Boleto</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {charge.identificationField && (
                  <>
                    <div className="text-xs font-mono bg-muted p-2 rounded break-all">
                      {charge.identificationField}
                    </div>
                    <CopyBtn value={charge.identificationField} label="Copiar linha" />
                  </>
                )}
                {charge.bankSlipUrl && (
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <a href={charge.bankSlipUrl} target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4 mr-1" /> Baixar PDF
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {charge.invoiceUrl && (
            <Card>
              <CardContent className="pt-4">
                <Button variant="outline" className="w-full" asChild>
                  <a href={charge.invoiceUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" /> Abrir fatura Asaas
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={async () => {
                  const res = await fetch(
                    `/api/financeiro/charges/${chargeId}/public-link`,
                    { method: "POST", credentials: "include" }
                  );
                  const data = await res.json();
                  if (!res.ok) {
                    toast.error("Falha ao gerar link");
                    return;
                  }
                  navigator.clipboard.writeText(data.url);
                  toast.success("Link público copiado");
                }}
              >
                <Link2 className="h-4 w-4 mr-1" /> Copiar link de pagamento
              </Button>
            </CardContent>
          </Card>

          <Button variant="outline" size="sm" onClick={load} className="w-full">
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar status
          </Button>
        </div>
      </div>

      {/* Dialog editar cobrança */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar cobrança</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="edit-value">Valor (R$)</Label>
              <Input
                id="edit-value"
                type="number"
                step="0.01"
                min="0.01"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-due">Vencimento</Label>
              <Input
                id="edit-due"
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <Label htmlFor="edit-desc">Descrição</Label>
              <Textarea
                id="edit-desc"
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                maxLength={500}
                placeholder="Ex: Aluguel abril/2026"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog cancelar cobrança */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar cobrança?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação cancela a cobrança no Asaas e marca como CANCELLED no
              sistema. Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                cancel();
              }}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Cancelar cobrança
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog baixa manual */}
      <Dialog open={cashOpen} onOpenChange={setCashOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como pago em dinheiro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Registra o pagamento fora do Asaas (dinheiro, transferência direta, etc).
              Não movimenta saldo na Asaas.
            </p>
            <div>
              <Label htmlFor="cash-date">Data do pagamento</Label>
              <Input
                id="cash-date"
                type="date"
                value={cashDate}
                onChange={(e) => setCashDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={markCash} disabled={busy || !cashDate}>
              Confirmar baixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
