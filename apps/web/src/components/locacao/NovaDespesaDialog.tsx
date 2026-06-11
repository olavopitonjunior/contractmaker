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
import { EXPENSE_TYPES } from "@/lib/locacao/validators";

const TYPE_LABELS: Record<string, string> = {
  iptu: "IPTU",
  condominio: "Condomínio",
  seguro_incendio: "Seguro incêndio",
  seguro_fianca: "Seguro fiança",
  juros: "Juros",
  multa: "Multa",
  honorarios: "Honorários",
  atualizacao_monetaria: "Atualização monetária",
  custas: "Custas",
  moratorios: "Moratórios",
  taxa_locacao: "Taxa de locação",
  outro: "Outro",
};

interface ContractOption {
  id: string;
  label: string;
}

export function NovaDespesaDialog({ contracts }: { contracts: ContractOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    leaseContractId: contracts[0]?.id ?? "",
    type: "iptu",
    descricao: "",
    valor: "",
    dueDate: new Date().toISOString().slice(0, 10),
    parcelaN: "1",
    parcelaTotal: "1",
    debitoDe: "locatario",
    creditoPara: "imobiliaria",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/locacao/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseContractId: form.leaseContractId || undefined,
          type: form.type,
          descricao: form.descricao || undefined,
          valor: Number(form.valor),
          dueDate: form.dueDate,
          parcelaN: Number(form.parcelaN),
          parcelaTotal: Number(form.parcelaTotal),
          debitoDe: form.debitoDe,
          creditoPara: form.creditoPara,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Despesa lançada");
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
        <Button size="sm" disabled={contracts.length === 0}>
          <Plus className="mr-1 h-4 w-4" />
          Nova despesa
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Lançar despesa</DialogTitle>
          <DialogDescription>
            Vinculada a um contrato. Quando rentChargeId for setada, entra no boleto.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Contrato</Label>
            <Select
              value={form.leaseContractId}
              onValueChange={(v) => setForm({ ...form, leaseContractId: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {contracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                required
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Vencimento</Label>
              <Input
                type="date"
                required
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Parcela / Total</Label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  min={1}
                  value={form.parcelaN}
                  onChange={(e) => setForm({ ...form, parcelaN: e.target.value })}
                />
                <Input
                  type="number"
                  min={1}
                  value={form.parcelaTotal}
                  onChange={(e) => setForm({ ...form, parcelaTotal: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Débito de</Label>
              <Select
                value={form.debitoDe}
                onValueChange={(v) => setForm({ ...form, debitoDe: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="locatario">Locatário</SelectItem>
                  <SelectItem value="proprietario">Proprietário</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Crédito para</Label>
              <Select
                value={form.creditoPara}
                onValueChange={(v) => setForm({ ...form, creditoPara: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="proprietario">Proprietário</SelectItem>
                  <SelectItem value="imobiliaria">Imobiliária</SelectItem>
                  <SelectItem value="fornecedor">Fornecedor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Descrição (opcional)</Label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Lançar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
