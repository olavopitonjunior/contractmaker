"use client";

/**
 * Dialog de consentimento LGPD para consulta de crédito — genérico por
 * ENDPOINT. Nasceu como `SerasaConsentDialog` (acoplado a deal + Serasa) e
 * foi generalizado em 2026-09 para a proposta (Ficha Certa): o texto legal é
 * o mesmo, muda só onde o registro é gravado. `SerasaConsentDialog` continua
 * existindo como invólucro fino, para os call-sites do negócio.
 *
 * Bases legais expostas (LGPD):
 *   - "protecao_credito"  : padrão. Lei 12.414/2011 + LGPD art. 7º, V.
 *   - "execucao_contrato" : LGPD art. 7º, V (execução pré-contratual a pedido
 *                          do titular). Use quando o consultado é parte do contrato.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export type CreditConsentBaseLegal = "protecao_credito" | "execucao_contrato";

export interface CreditConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** POST recebe `{ baseLegal }`. */
  endpoint: string;
  /** Ex.: "Serasa", "Ficha Certa". Entra no título e na descrição. */
  providerLabel: string;
  /** "este negócio" | "esta proposta". */
  subjectLabel: string;
  /** Ação de auditoria citada no rodapé. */
  auditAction: string;
  /** Chamado depois do consent gravado com sucesso. */
  onGranted?: () => void;
}

const BASE_LEGAL_OPTIONS: Array<{
  value: CreditConsentBaseLegal;
  label: string;
  description: string;
}> = [
  {
    value: "protecao_credito",
    label: "Proteção ao crédito",
    description:
      "Lei 12.414/2011 + LGPD art. 7º, V. Padrão para consulta de score e restritivos antes de fechar negócio.",
  },
  {
    value: "execucao_contrato",
    label: "Execução de contrato",
    description:
      "LGPD art. 7º, V. Aplicável quando o consultado é parte do contrato e a consulta é necessária para o fechamento.",
  },
];

export function CreditConsentDialog({
  open,
  onOpenChange,
  endpoint,
  providerLabel,
  subjectLabel,
  auditAction,
  onGranted,
}: CreditConsentDialogProps) {
  const [selected, setSelected] = useState<CreditConsentBaseLegal>("protecao_credito");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseLegal: selected }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Falha ao registrar consentimento.");
        return;
      }
      toast.success(`Consentimento LGPD registrado. Você pode disparar consultas ${providerLabel}.`);
      onGranted?.();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            Consentimento para consulta {providerLabel}
          </DialogTitle>
          <DialogDescription>
            Consultas de crédito (score, restritivos, vínculos) exigem base legal explícita sob a
            LGPD. Selecione qual se aplica a {subjectLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {BASE_LEGAL_OPTIONS.map((opt) => {
            const isChecked = selected === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded border p-3 cursor-pointer ${
                  isChecked ? "border-amber-500 bg-amber-50" : "hover:bg-muted/30"
                }`}
              >
                <input
                  type="radio"
                  name="baseLegal"
                  checked={isChecked}
                  onChange={() => setSelected(opt.value)}
                  className="mt-1 h-4 w-4 accent-amber-600"
                />
                <div>
                  <div className="font-medium text-sm">{opt.label}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                </div>
              </label>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground">
          O registro fica vinculado a {subjectLabel} e é auditável (ação <code>{auditAction}</code>).
          Você pode revogar a qualquer momento.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Registrar e continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
