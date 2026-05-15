"use client";

/**
 * Dialog de consentimento LGPD pra consultas Serasa.
 *
 * Acionado quando o usuário tenta disparar um batch que inclui endpoints
 * Serasa pela primeira vez no deal. Persiste em `Deal.complianceJson.serasaConsent`
 * via POST /api/deals/[id]/serasa/consent. Sem isso o POST /certidoes retorna
 * 412 (`requiresConsent: true`).
 *
 * Bases legais expostas (LGPD):
 *   - "protecao_credito"  : padrão. Lei 12.414/2011 + LGPD art. 7º, V.
 *   - "execucao_contrato" : LGPD art. 7º, V (execução pré-contratual a pedido
 *                          do titular). Use quando o consultado é parte do CCV.
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

type BaseLegal = "protecao_credito" | "execucao_contrato";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /** Chamado depois do consent gravado com sucesso. UI deve então re-tentar o POST /certidoes. */
  onGranted?: () => void;
}

const BASE_LEGAL_OPTIONS: Array<{
  value: BaseLegal;
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
      "LGPD art. 7º, V. Aplicável quando o consultado é parte do CCV e a consulta é necessária pra fechamento.",
  },
];

export function SerasaConsentDialog({ open, onOpenChange, dealId, onGranted }: Props) {
  const [selected, setSelected] = useState<BaseLegal>("protecao_credito");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/serasa/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseLegal: selected }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Falha ao registrar consentimento.");
        return;
      }
      toast.success("Consentimento LGPD registrado. Você pode disparar consultas Serasa.");
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
            Consentimento para consulta Serasa
          </DialogTitle>
          <DialogDescription>
            Consultas Serasa (score, restritivos, vínculos) exigem base legal explícita
            sob a LGPD. Selecione qual se aplica a este negócio.
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
          O registro fica vinculado a este deal e é auditável (ação{" "}
          <code>SERASA_CONSENT_GIVEN</code>). Você pode revogar a qualquer momento.
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
