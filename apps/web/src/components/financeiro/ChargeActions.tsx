"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { Pencil, Mail, Wallet, Ban, Undo2 } from "lucide-react";

export interface ChargeActionsProps {
  chargeId: string;
  status: string;
  value: number;
  currentDueDate: string;
  description: string | null;
  /** Callback após qualquer mutação bem-sucedida — caller faz reload */
  onChanged: () => void;
  /** Modo compacto: botões só com ícone + tooltip (usado em cards de lista) */
  compact?: boolean;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Barra de ações de cobrança (CommissionCharge). Renderiza botões inline
 * conforme status:
 *   PENDING / OVERDUE → Editar · Reenviar · Pago em dinheiro · Cancelar
 *   RECEIVED / CONFIRMED → Estornar
 *   demais → nada
 *
 * Implementado com botões diretos (sem Radix DropdownMenu) — o Popper do
 * DropdownMenu falhou em medir o anchor em telas largas, abrindo o menu
 * fora da viewport (translate(0, -200%)).
 */
export function ChargeActions({
  chargeId,
  status,
  value,
  currentDueDate,
  description,
  onChanged,
  compact = false,
}: ChargeActionsProps) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashDate, setCashDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [refundOpen, setRefundOpen] = useState(false);

  const isActive = status === "PENDING" || status === "OVERDUE";
  const isRefundable = status === "RECEIVED" || status === "CONFIRMED";
  if (!isActive && !isRefundable) return null;

  function openEdit() {
    setEditValue(value.toString());
    setEditDueDate(currentDueDate.slice(0, 10));
    setEditDescription(description ?? "");
    setEditOpen(true);
  }

  async function saveEdit() {
    const body: { value?: number; dueDate?: string; description?: string } = {};
    const valueNum = parseFloat(editValue);
    if (!Number.isNaN(valueNum) && valueNum !== value) body.value = valueNum;
    if (editDueDate && editDueDate !== currentDueDate.slice(0, 10)) {
      body.dueDate = editDueDate;
    }
    if (editDescription !== (description ?? "")) {
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
        toast.error(
          data.message ?? data.details?.[0]?.description ?? data.error ?? "Falha"
        );
        return;
      }
      toast.success("Cobrança atualizada");
      setEditOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

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
      onChanged();
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
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/financeiro/charges/${chargeId}/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "ELEVATION_REQUIRED") {
          toast.error(
            "Estorno > R$ 10k exige confirmação de identidade — tente novamente"
          );
        } else {
          toast.error(data.details?.[0]?.description ?? data.error ?? "Falha");
        }
        return;
      }
      toast.success("Estorno iniciado");
      setRefundOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const sz = compact ? "sm" : "default";
  const iconCls = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {isActive && (
          <>
            <Button
              variant="outline"
              size={sz}
              onClick={openEdit}
              disabled={busy}
              title="Alterar valor, vencimento ou descrição"
            >
              <Pencil className={`${iconCls} ${compact ? "" : "mr-1"}`} />
              {!compact && "Editar"}
            </Button>
            <Button
              variant="outline"
              size={sz}
              onClick={resendNotif}
              disabled={busy}
              title="Reenviar email de cobrança ao pagador"
            >
              <Mail className={`${iconCls} ${compact ? "" : "mr-1"}`} />
              {!compact && "Reenviar"}
            </Button>
            <Button
              variant="outline"
              size={sz}
              onClick={() => setCashOpen(true)}
              disabled={busy}
              title="Registrar pagamento fora do Asaas"
            >
              <Wallet className={`${iconCls} ${compact ? "" : "mr-1"}`} />
              {!compact && "Marcar pago"}
            </Button>
            <Button
              variant="outline"
              size={sz}
              onClick={() => setCancelOpen(true)}
              disabled={busy}
              className="text-red-600 border-red-300 hover:bg-red-50"
              title="Cancelar cobrança no Asaas"
            >
              <Ban className={`${iconCls} ${compact ? "" : "mr-1"}`} />
              {!compact && "Cancelar"}
            </Button>
          </>
        )}
        {isRefundable && (
          <Button
            variant="outline"
            size={sz}
            onClick={() => setRefundOpen(true)}
            disabled={busy}
            className="text-red-600 border-red-300 hover:bg-red-50"
            title="Estornar valor para o pagador"
          >
            <Undo2 className={`${iconCls} ${compact ? "" : "mr-1"}`} />
            {!compact && "Estornar"}
          </Button>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar cobrança</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ca-edit-value">Valor (R$)</Label>
              <Input
                id="ca-edit-value"
                type="number"
                step="0.01"
                min="0.01"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ca-edit-due">Vencimento</Label>
              <Input
                id="ca-edit-due"
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <Label htmlFor="ca-edit-desc">Descrição</Label>
              <Textarea
                id="ca-edit-desc"
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

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar cobrança?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação cancela a cobrança de {fmtBRL(value)} no Asaas e marca
              como CANCELLED no sistema. Não pode ser desfeita.
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

      <Dialog open={cashOpen} onOpenChange={setCashOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como pago em dinheiro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Registra pagamento fora do Asaas (dinheiro, transferência direta,
              etc). Não movimenta saldo.
            </p>
            <div>
              <Label htmlFor="ca-cash-date">Data do pagamento</Label>
              <Input
                id="ca-cash-date"
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

      <AlertDialog open={refundOpen} onOpenChange={setRefundOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Estornar {fmtBRL(value)}?</AlertDialogTitle>
            <AlertDialogDescription>
              O valor retorna ao pagador via Asaas. Estornos acima de R$ 10.000
              exigem confirmação de identidade extra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                refund();
              }}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Confirmar estorno
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
