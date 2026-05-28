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

interface Props {
  properties: Option[];
  tenants: Option[];
}

export function NovoDealLocacaoDialog({ properties, tenants }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    propertyId: properties[0]?.id ?? "",
    tenantId: tenants[0]?.id ?? "",
    valorAluguel: "",
    vigenciaMeses: "30",
  });

  const canSubmit =
    form.propertyId && form.tenantId && form.valorAluguel && Number(form.valorAluguel) > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/locacao/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: form.propertyId,
          tenantId: form.tenantId,
          valorAluguel: Number(form.valorAluguel),
          vigenciaMeses: Number(form.vigenciaMeses),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { dealId: string; stage: string };
      toast.success(`Deal criado no stage "${data.stage}"`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  const noPropertyOrTenant = properties.length === 0 || tenants.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={noPropertyOrTenant}>
          <Plus className="mr-1 h-4 w-4" />
          Novo deal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Novo Deal de Locação</DialogTitle>
          <DialogDescription>
            Cria um deal no primeiro stage da Esteira (Análise de Crédito). O contrato em si vira
            <code className="mx-1 text-xs">LeaseContract</code> quando o deal chega em &quot;Chaves Entregues&quot;.
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
                <SelectValue placeholder="Selecione um imóvel" />
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
          <div className="space-y-1">
            <Label>Inquilino</Label>
            <Select
              value={form.tenantId}
              onValueChange={(v) => setForm({ ...form, tenantId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um inquilino" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Aluguel (R$)</Label>
              <Input
                type="number"
                step="0.01"
                required
                value={form.valorAluguel}
                onChange={(e) => setForm({ ...form, valorAluguel: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Vigência (meses)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={form.vigenciaMeses}
                onChange={(e) => setForm({ ...form, vigenciaMeses: e.target.value })}
              />
            </div>
          </div>
          {noPropertyOrTenant && (
            <p className="text-xs text-destructive">
              Você precisa de ao menos 1 imóvel e 1 inquilino cadastrados.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || saving}>
              {saving ? "..." : "Criar deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
