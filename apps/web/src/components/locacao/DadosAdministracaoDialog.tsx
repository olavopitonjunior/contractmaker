"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/forms/NativeSelect";

const REGIME_IR = [
  { value: "nao_retem", label: "Não retém IR" },
  { value: "retem_imobiliaria", label: "Retém (imobiliária)" },
  { value: "retem_inquilino", label: "Retém (inquilino)" },
  { value: "retem_sem_controle", label: "Retém sem controle" },
];
const REGIME_COBRANCA = [
  { value: "mes_a_vencer", label: "Mês a vencer" },
  { value: "mes_vencido", label: "Mês vencido" },
];

/** Bloco `fiscal` do dataJson lido/gravado por este diálogo. */
export interface DadosAdministracaoValue {
  taxa_admin_percent?: number;
  regime_ir?: string;
  regime_cobranca?: string;
  emitir_nfse?: boolean;
}

interface DadosAdministracaoDialogProps {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-preenchimento — `fiscal` do dataJson (espelhado do LeaseContract). */
  initial?: DadosAdministracaoValue;
  /** Roda depois do PATCH bem-sucedido: dispara a geração do contrato. */
  onConfirmed: () => Promise<void> | void;
}

/**
 * Coleta os dados da ADMINISTRAÇÃO (taxa, IR, regime de cobrança, NFS-e) antes
 * de gerar o instrumento imobiliária ↔ proprietário. Esses campos ficavam no
 * diálogo de criação do formulário público, onde eram pedidos cedo demais — a
 * administração só é acertada quando o contrato de administração é fechado.
 *
 * Grava no `fiscal` do dataJson (merge escopado) e só então chama a geração.
 * Reabre pré-preenchido numa regeração.
 */
export function DadosAdministracaoDialog({
  dealId,
  open,
  onOpenChange,
  initial,
  onConfirmed,
}: DadosAdministracaoDialogProps) {
  const [taxaAdmin, setTaxaAdmin] = useState<number>(initial?.taxa_admin_percent ?? 10);
  const [regimeIr, setRegimeIr] = useState(initial?.regime_ir ?? "nao_retem");
  const [regimeCobranca, setRegimeCobranca] = useState(
    initial?.regime_cobranca ?? "mes_a_vencer"
  );
  const [emitirNfse, setEmitirNfse] = useState(initial?.emitir_nfse ?? false);
  const [submitting, setSubmitting] = useState(false);

  // Reabrir depois de uma geração precisa refletir o que foi gravado (o pai
  // revalida o dataJson no router.refresh); o state inicial é do 1º mount.
  useEffect(() => {
    if (!open) return;
    setTaxaAdmin(initial?.taxa_admin_percent ?? 10);
    setRegimeIr(initial?.regime_ir ?? "nao_retem");
    setRegimeCobranca(initial?.regime_cobranca ?? "mes_a_vencer");
    setEmitirNfse(initial?.emitir_nfse ?? false);
  }, [
    open,
    initial?.taxa_admin_percent,
    initial?.regime_ir,
    initial?.regime_cobranca,
    initial?.emitir_nfse,
  ]);

  const submit = async () => {
    if (!Number.isFinite(taxaAdmin) || taxaAdmin < 0 || taxaAdmin > 100) {
      toast.error("Taxa de administração deve ficar entre 0 e 100%.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/locacao/deals/${dealId}/fiscal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxa_admin_percent: taxaAdmin,
          regime_ir: regimeIr,
          regime_cobranca: regimeCobranca,
          emitir_nfse: emitirNfse,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as Record<string, unknown>);
        toast.error(
          (typeof body?.error === "string" && body.error) ||
            "Falha ao salvar os dados da administração."
        );
        return;
      }
      onOpenChange(false);
      await onConfirmed();
    } catch {
      toast.error("Falha ao salvar os dados da administração.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dados da administração</DialogTitle>
          <DialogDescription>
            Condições da administração do imóvel. Vão para o contrato de
            administração e para o repasse ao proprietário.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm" htmlFor="adm-taxa">
              Taxa de administração (%)
            </Label>
            <Input
              id="adm-taxa"
              type="number"
              min={0}
              max={100}
              value={taxaAdmin}
              onChange={(e) => setTaxaAdmin(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Regime de IR</Label>
            <NativeSelect value={regimeIr} onChange={setRegimeIr} options={REGIME_IR} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Regime de cobrança</Label>
            <NativeSelect
              value={regimeCobranca}
              onChange={setRegimeCobranca}
              options={REGIME_COBRANCA}
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="adm-emitir-nfse"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={emitirNfse}
              onChange={(e) => setEmitirNfse(e.target.checked)}
            />
            <Label htmlFor="adm-emitir-nfse" className="cursor-pointer text-sm">
              Emitir NFS-e por repasse
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Salvando..." : "Salvar e gerar contrato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
