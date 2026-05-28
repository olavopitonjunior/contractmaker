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
import { PROPERTY_KINDS } from "@/lib/locacao/validators";

const KIND_LABELS: Record<string, string> = {
  apartamento: "Apartamento",
  casa: "Casa",
  sobrado: "Sobrado",
  cobertura: "Cobertura",
  studio: "Studio",
  kitnet: "Kitnet",
  flat: "Flat",
  loft: "Loft",
  sala_comercial: "Sala comercial",
  loja: "Loja",
  galpao: "Galpão",
  terreno: "Terreno",
  outro: "Outro",
};

export function NovoImovelDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    kind: "apartamento",
    rua: "",
    numero: "",
    bairro: "",
    cidade: "",
    uf: "SP",
    cep: "",
    area: "",
    valorAluguelSugerido: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/locacao/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          status: "disponivel",
          rua: form.rua || undefined,
          numero: form.numero || undefined,
          bairro: form.bairro || undefined,
          cidade: form.cidade || undefined,
          uf: form.uf || undefined,
          cep: form.cep || undefined,
          area: form.area ? Number(form.area) : undefined,
          valorAluguelSugerido: form.valorAluguelSugerido
            ? Number(form.valorAluguelSugerido)
            : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Imóvel cadastrado");
      setOpen(false);
      setForm({
        kind: "apartamento",
        rua: "",
        numero: "",
        bairro: "",
        cidade: "",
        uf: "SP",
        cep: "",
        area: "",
        valorAluguelSugerido: "",
      });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Novo imóvel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Cadastrar imóvel</DialogTitle>
          <DialogDescription>
            Endereço e dados básicos. Proprietários (com %) são adicionados na ficha do imóvel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k] ?? k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Logradouro</Label>
              <Input value={form.rua} onChange={(e) => setForm({ ...form, rua: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Número</Label>
              <Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>CEP</Label>
              <Input value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Bairro</Label>
              <Input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Cidade</Label>
              <Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>UF</Label>
              <Input maxLength={2} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} />
            </div>
            <div className="space-y-1">
              <Label>Área (m²)</Label>
              <Input type="number" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Valor de aluguel sugerido (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.valorAluguelSugerido}
                onChange={(e) => setForm({ ...form, valorAluguelSugerido: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
