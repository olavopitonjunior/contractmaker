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

interface Option {
  id: string;
  label: string;
}

const TIPO_LABELS: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  contra: "Contravistoria",
};

const NONE = "__none__";

export function NovaVistoriaDialog({
  properties,
  contracts,
}: {
  properties: Option[];
  contracts: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    propertyId: properties[0]?.id ?? "",
    tipo: "entrada",
    leaseContractId: NONE,
    scheduledFor: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.propertyId) {
      toast.error("Selecione o imóvel.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/locacao/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: form.propertyId,
          tipo: form.tipo,
          leaseContractId: form.leaseContractId === NONE ? undefined : form.leaseContractId,
          scheduledFor: form.scheduledFor || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // `error` pode vir como objeto (ex.: detalhes Zod) — evita toast "[object Object]".
        const msg = typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      toast.success(form.scheduledFor ? "Vistoria agendada" : "Vistoria criada");
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
        <Button size="sm" disabled={properties.length === 0}>
          <Plus className="mr-1 h-4 w-4" />
          Nova vistoria
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Agendar vistoria</DialogTitle>
          <DialogDescription>
            Vistoria de entrada, saída ou contravistoria de um imóvel. O laudo é
            preenchido pelo vistoriador no app.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Imóvel</Label>
            <Select
              value={form.propertyId}
              onValueChange={(v) => setForm({ ...form, propertyId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o imóvel" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPO_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Data (opcional)</Label>
              <Input
                type="date"
                value={form.scheduledFor}
                onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Contrato (opcional)</Label>
            <Select
              value={form.leaseContractId}
              onValueChange={(v) => setForm({ ...form, leaseContractId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem contrato vinculado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem contrato vinculado</SelectItem>
                {contracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : form.scheduledFor ? "Agendar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
