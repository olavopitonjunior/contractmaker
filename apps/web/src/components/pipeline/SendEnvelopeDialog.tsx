"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Mail, Send, Wallet } from "lucide-react";

interface PartePreview {
  sourceKind: "vendedor" | "comprador";
  sourceIndex: number;
  name: string;
  email: string | null;
  hasEmail: boolean;
}

interface SendEnvelopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractTitle: string;
  partes: PartePreview[];
  onSent: () => void;
}

const COST_PER_SIGNER_CENTS = 150;

export function SendEnvelopeDialog({
  open,
  onOpenChange,
  contractId,
  contractTitle,
  partes,
  onSent,
}: SendEnvelopeDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  const valid = useMemo(() => partes.filter((p) => p.hasEmail), [partes]);
  const missing = useMemo(() => partes.filter((p) => !p.hasEmail), [partes]);
  const costCents = valid.length * COST_PER_SIGNER_CENTS;
  const canSend = valid.length > 0 && missing.length === 0;

  useEffect(() => {
    if (!open) setSubmitting(false);
  }, [open]);

  const handleSend = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/envelopes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authMethod: "email" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(body.missing)) {
          toast.error(
            `Faltam e-mails em ${body.missing.length} parte(s). Edite o Deal antes de reenviar.`
          );
          return;
        }
        if (res.status === 402) {
          toast.error(
            `Orçamento mensal excedido. Gasto: R$ ${(body.spentCents / 100).toFixed(2)} de R$ ${(body.budgetCents / 100).toFixed(2)}.`
          );
          return;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success("Envelope enviado para assinatura");
      onSent();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar para assinatura</DialogTitle>
          <DialogDescription>
            {contractTitle} — autenticação por token de e-mail (padrão)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <h4 className="text-sm font-medium text-foreground/80 mb-2">
              Signatários
            </h4>
            {valid.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum signatário válido. Adicione e-mails às partes do Deal.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {valid.map((p) => (
                  <li
                    key={`${p.sourceKind}-${p.sourceIndex}`}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{p.name}</span>
                      <span className="text-muted-foreground truncate">
                        {p.email}
                      </span>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {p.sourceKind}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {missing.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-amber-800 mb-1">
                <AlertTriangle className="h-4 w-4" />
                {missing.length} parte(s) sem e-mail
              </div>
              <ul className="text-amber-900 space-y-0.5 ml-6 list-disc">
                {missing.map((p) => (
                  <li key={`${p.sourceKind}-${p.sourceIndex}`}>
                    {p.name} ({p.sourceKind})
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-800 mt-2">
                Edite o Deal e adicione os e-mails antes de enviar.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Wallet className="h-4 w-4" /> Custo estimado
            </span>
            <span className="text-sm font-medium">
              R$ {(costCents / 100).toFixed(2)}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={!canSend || submitting}>
            <Send className="h-4 w-4 mr-2" />
            {submitting ? "Enviando..." : "Enviar envelope"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
