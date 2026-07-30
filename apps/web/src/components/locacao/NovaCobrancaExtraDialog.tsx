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
import { Plus } from "lucide-react";
import { MoneyInput } from "@/components/forms/MoneyInput";

interface Props {
  leaseContractId: string;
}

function defaultCompetencia(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function NovaCobrancaExtraDialog({ leaseContractId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    kind: "extra",
    competencia: defaultCompetencia(),
    dueDate: defaultDueDate(),
    valorBase: "",
    encargos: "0",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // O MoneyInput não é um <input required>, então o valor é checado aqui.
    if (!(Number(form.valorBase) > 0)) {
      toast.error("Informe o valor da cobrança (maior que zero).");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/locacao/rent-charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseContractId,
          kind: form.kind,
          competencia: form.competencia,
          dueDate: form.dueDate,
          valorBase: Number(form.valorBase),
          encargos: Number(form.encargos),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Cobrança extra criada");
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
        <Button size="sm" variant="outline">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Nova cobrança extra
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Nova cobrança extra</DialogTitle>
          <DialogDescription>
            Cobrança avulsa fora do aluguel mensal. Aparece junto no próximo boleto da
            competência.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="extra">Extra</SelectItem>
                  <SelectItem value="encargo">Encargo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Competência</Label>
              <Input
                placeholder="YYYY-MM"
                required
                value={form.competencia}
                onChange={(e) => setForm({ ...form, competencia: e.target.value })}
              />
            </div>
            {/* R$ pelo MoneyInput; o estado segue string (Number() no submit). */}
            <div className="space-y-1">
              <Label>Valor (R$)</Label>
              <MoneyInput
                value={Number(form.valorBase) || 0}
                onChange={(v) => setForm({ ...form, valorBase: String(v) })}
                placeholder="Ex: 350,00"
              />
            </div>
            <div className="space-y-1">
              <Label>Encargos (R$)</Label>
              <MoneyInput
                value={Number(form.encargos) || 0}
                onChange={(v) => setForm({ ...form, encargos: String(v) })}
                placeholder="Ex: 0,00"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Vencimento</Label>
              <Input
                type="date"
                required
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "..." : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
