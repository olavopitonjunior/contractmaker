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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function ChargeDetail({ chargeId }: { chargeId: string }) {
  const router = useRouter();
  const [charge, setCharge] = useState<ChargeDetailData | null>(null);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [newDueDate, setNewDueDate] = useState("");
  const [cashOpen, setCashOpen] = useState(false);
  const [cashDate, setCashDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [busy, setBusy] = useState(false);

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
      setNewDueDate(data.charge.currentDueDate?.slice(0, 10) ?? "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeId]);

  async function cancel() {
    if (!confirm("Cancelar esta cobrança? A ação não pode ser desfeita.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/charges/${chargeId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha");
        return;
      }
      toast.success("Cobrança cancelada");
      await load();
    } finally {
      setBusy(false);
    }
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

  async function saveDueDate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/charges/${chargeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dueDate: newDueDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.description ?? data.error ?? "Falha");
        return;
      }
      toast.success("Vencimento atualizado");
      setDueDateOpen(false);
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
                        <DropdownMenuItem onSelect={() => setDueDateOpen(true)}>
                          <Calendar className="h-4 w-4 mr-2" /> Alterar vencimento
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={resendNotif}>
                          <Mail className="h-4 w-4 mr-2" /> Reenviar notificação
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setCashOpen(true)}>
                          <Wallet className="h-4 w-4 mr-2" /> Marcar como pago em dinheiro
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={cancel}
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

      {/* Dialog alterar vencimento */}
      <Dialog open={dueDateOpen} onOpenChange={setDueDateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar vencimento</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-due">Nova data</Label>
            <Input
              id="new-due"
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDueDateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveDueDate} disabled={busy || !newDueDate}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
