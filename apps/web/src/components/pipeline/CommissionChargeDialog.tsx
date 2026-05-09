"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ChargeWizard, {
  type ChargeWizardMode,
} from "@/components/financeiro/ChargeWizard";

/**
 * Dialog wrapper para o wizard reutilizável. Por default abre em modo
 * `commission_from_deal` (puxa pagador/valor/splits do contrato aprovado).
 * Pode ser reutilizado pra `avulsa_in_deal` mudando o `mode` via prop.
 *
 * O `mode` interno é controlado por estado pra suportar troca em runtime
 * (ex: banner "Trocar para cobrança avulsa" preservando state do wizard).
 */
export function CommissionChargeDialog({
  dealId,
  open,
  onOpenChange,
  onCreated,
  mode = "commission_from_deal",
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (charge: { id: string }) => void;
  mode?: ChargeWizardMode;
}) {
  const [activeMode, setActiveMode] = useState<ChargeWizardMode>(mode);

  // Reseta mode interno quando o dialog abre com mode diferente do anterior
  useEffect(() => {
    if (open) setActiveMode(mode);
  }, [open, mode]);

  const title =
    activeMode === "commission_from_deal"
      ? "Gerar cobrança de comissão"
      : "Nova cobrança avulsa neste deal";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ChargeWizard
          // key força remontagem do wizard quando o mode muda — splits state
          // é zerado mas pagador/valor/vencimento são repreenchidos pelo summary
          key={activeMode}
          mode={activeMode}
          dealId={dealId}
          onCreated={(c) => {
            onCreated?.(c);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
          onModeChange={setActiveMode}
        />
      </DialogContent>
    </Dialog>
  );
}
