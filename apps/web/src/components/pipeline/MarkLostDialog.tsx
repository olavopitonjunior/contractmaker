"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, XOctagon } from "lucide-react";

export interface LostCategoryOption {
  value: string;
  label: string;
}

const VENDA_CATEGORIES: LostCategoryOption[] = [
  { value: "desistencia", label: "Cliente desistiu" },
  { value: "imovel_vendido", label: "Imóvel vendido a terceiro" },
  { value: "financiamento_negado", label: "Financiamento negado" },
  { value: "outro", label: "Outro motivo" },
];

export const LOCACAO_LOST_CATEGORIES: LostCategoryOption[] = [
  { value: "desistencia", label: "Cliente desistiu" },
  { value: "imovel_alugado", label: "Imóvel alugado por outro canal" },
  { value: "garantia_recusada", label: "Garantia recusada" },
  { value: "credito_reprovado", label: "Crédito reprovado" },
  { value: "outro", label: "Outro motivo" },
];

interface MarkLostDialogProps {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Causas exibidas no select. Default: categorias de venda. */
  categories?: LostCategoryOption[];
}

export function MarkLostDialog({
  dealId,
  open,
  onOpenChange,
  categories = VENDA_CATEGORIES,
}: MarkLostDialogProps) {
  const router = useRouter();
  const [category, setCategory] = useState<string>(categories[0]?.value ?? "outro");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requiresFreeText = category === "outro";
  const reasonValid = requiresFreeText
    ? reason.trim().length >= 3
    : reason.trim().length === 0 || reason.trim().length >= 3;

  async function handleSubmit() {
    if (!reasonValid) {
      toast.error(
        requiresFreeText
          ? "Informe o motivo (mínimo 3 caracteres) quando a categoria for 'Outro'."
          : "Detalhes precisam ter pelo menos 3 caracteres se preenchidos."
      );
      return;
    }

    const finalReason =
      reason.trim().length > 0
        ? reason.trim()
        : categories.find((c) => c.value === category)?.label ?? category;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/pipeline/deals/${dealId}/mark-lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, reason: finalReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao marcar como perdido");
        return;
      }
      toast.success("Negócio marcado como perdido. Você pode reabrir depois.");
      onOpenChange(false);
      setReason("");
      setCategory(categories[0]?.value ?? "outro");
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XOctagon className="h-5 w-5 text-red-600" />
            Marcar negócio como perdido
          </DialogTitle>
          <DialogDescription>
            Esta ação move o negócio pra coluna "Negócio perdido". Você pode
            reabrir depois pelo botão "Reabrir negócio".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="category">Causa</Label>
            <Select
              value={category}
              onValueChange={setCategory}
              disabled={submitting}
            >
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">
              Detalhes{" "}
              {requiresFreeText ? (
                <span className="text-red-600">*</span>
              ) : (
                <span className="text-muted-foreground">(opcional)</span>
              )}
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                requiresFreeText
                  ? "Descreva o motivo…"
                  : "Contexto adicional (opcional)"
              }
              rows={3}
              disabled={submitting}
              maxLength={500}
            />
          </div>

          <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Não exclui contratos, anexos ou cobranças associadas — só move o
              negócio pra terminal "perdido". Reversível.
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
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={submitting || !reasonValid}
          >
            {submitting ? "Marcando…" : "Marcar como perdido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
