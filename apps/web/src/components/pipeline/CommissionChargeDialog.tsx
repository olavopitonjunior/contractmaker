"use client";
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
  const title =
    mode === "commission_from_deal"
      ? "Gerar cobrança de comissão"
      : "Nova cobrança avulsa neste deal";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ChargeWizard
          mode={mode}
          dealId={dealId}
          onCreated={(c) => {
            onCreated?.(c);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
