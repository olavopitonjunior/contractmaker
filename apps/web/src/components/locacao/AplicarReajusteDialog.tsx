"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, TrendingUp } from "lucide-react";

const INDICE_LABEL: Record<string, string> = {
  IGPM: "IGPM (FGV)",
  IPCA: "IPCA (IBGE)",
  "IGP-DI": "IGP-DI (FGV)",
  outro: "Outro",
};

// Stubs alinhados com readjustment-calculator.ts.
const ACUMULADO_12M: Record<string, number> = {
  IGPM: 3.65,
  IPCA: 4.42,
  "IGP-DI": 3.21,
  outro: 0,
};

interface Props {
  leaseId: string;
  defaultIndice: string;
  valorAtual: number;
}

export function AplicarReajusteDialog({ leaseId, defaultIndice, valorAtual }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    indice: defaultIndice || "IGPM",
    percentualOverride: "",
    observacao: "",
    apply: false,
  });

  const percentual = form.percentualOverride
    ? Number(form.percentualOverride)
    : ACUMULADO_12M[form.indice] ?? 0;
  const valorNovo = Number((valorAtual * (1 + percentual / 100)).toFixed(2));
  const diff = valorNovo - valorAtual;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/locacao/leases/${leaseId}/readjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indice: form.indice,
          percentualOverride: form.percentualOverride
            ? Number(form.percentualOverride)
            : undefined,
          observacao: form.observacao || undefined,
          apply: form.apply,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(form.apply ? "Reajuste aplicado" : "Reajuste proposto pra aprovação");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <TrendingUp className="mr-1 h-4 w-4" />
          Aplicar reajuste
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Aplicar reajuste de aluguel</DialogTitle>
          <DialogDescription>
            Calcula valor novo via índice oficial (acumulado 12m) ou override manual.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Índice</Label>
            <Select value={form.indice} onValueChange={(v) => setForm({ ...form, indice: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INDICE_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v} ({ACUMULADO_12M[k]?.toFixed(2)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>% override (opcional)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder={`Padrão: ${ACUMULADO_12M[form.indice]?.toFixed(2)}%`}
              value={form.percentualOverride}
              onChange={(e) => setForm({ ...form, percentualOverride: e.target.value })}
            />
          </div>
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Atual</div>
                <div className="font-semibold">R$ {valorAtual.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">% aplicado</div>
                <div className="font-semibold">{percentual.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Novo</div>
                <div className="font-semibold">R$ {valorNovo.toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-1 text-center text-xs text-muted-foreground">
              Diferença: R$ {diff.toFixed(2)}/mês
            </div>
          </div>
          <div className="space-y-1">
            <Label>Observação (opcional)</Label>
            <Input
              value={form.observacao}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="apply"
              checked={form.apply}
              onChange={(e) => setForm({ ...form, apply: e.target.checked })}
              className="rounded border-input"
            />
            <Label htmlFor="apply" className="text-sm font-normal">
              Aplicar imediatamente (senão fica como proposta pra aprovar)
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "..." : form.apply ? "Aplicar" : "Propor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
