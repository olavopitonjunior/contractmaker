"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CommissionChargeDialog({
  dealId,
  open,
  onOpenChange,
  onCreated,
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (charge: any) => void;
}) {
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO">("PIX");
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 7);
  const [dueDate, setDueDate] = useState(defaultDue.toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/commission-charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          billingType,
          dueDate,
          description: description || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data.error === "ASAAS_ERROR" && data.details?.[0]?.description
            ? data.details[0].description
            : data.message ?? data.error ?? `HTTP ${res.status}`;
        toast.error(msg);
        return;
      }
      toast.success("Cobrança gerada com sucesso");
      onCreated?.(data.charge);
      onOpenChange(false);
      setDescription("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gerar cobrança de comissão</DialogTitle>
          <DialogDescription>
            O valor será calculado a partir do contrato aprovado. O pagador é
            quem está definido como responsável pela comissão no formulário de
            venda.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Método de pagamento</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`border rounded-md p-3 text-sm font-medium transition ${
                  billingType === "PIX"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-muted"
                }`}
                onClick={() => setBillingType("PIX")}
              >
                PIX
                <div className="text-xs font-normal text-muted-foreground mt-1">
                  Aprovação em segundos
                </div>
              </button>
              <button
                type="button"
                className={`border rounded-md p-3 text-sm font-medium transition ${
                  billingType === "BOLETO"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-muted"
                }`}
                onClick={() => setBillingType("BOLETO")}
              >
                Boleto
                <div className="text-xs font-normal text-muted-foreground mt-1">
                  Prazo de vencimento
                </div>
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="cc-due">Vencimento</Label>
            <Input
              id="cc-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {billingType === "PIX"
                ? "PIX aceita pagamento até esta data"
                : "Boleto vence nesta data — após, aplica multa e juros configurados"}
            </p>
          </div>

          <div>
            <Label htmlFor="cc-desc">Descrição (opcional)</Label>
            <Input
              id="cc-desc"
              placeholder="Ex: Comissão referente à venda do imóvel X"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !dueDate}>
            {loading ? "Gerando..." : "Gerar cobrança"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
