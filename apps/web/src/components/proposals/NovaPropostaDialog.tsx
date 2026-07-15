"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

const SCHEMA_BY_TIPO: Record<string, { label: string; value: string }[]> = {
  venda: [{ label: "Compra e venda", value: "compra_venda_v1" }],
  locacao: [
    { label: "Locação residencial", value: "locacao_residencial_v1" },
    { label: "Locação comercial", value: "locacao_comercial_v1" },
  ],
};

/**
 * Criação de proposta numa tela só. Monta o dataJson no shape que a conversão e
 * os templates esperam (proponente = comprador/locatário; imóvel; valor), então
 * o negócio nasce sem retradução.
 */
export function NovaPropostaDialog({ tipo }: { tipo: "venda" | "locacao" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schemaType, setSchemaType] = useState(SCHEMA_BY_TIPO[tipo][0].value);
  const [form, setForm] = useState({
    proponente: "",
    proponenteEmail: "",
    proponenteFone: "",
    proponenteCanal: "email",
    vendedor: "",
    vendedorEmail: "",
    imovel: "",
    valor: "",
    validadeDias: "5",
  });

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.proponente.trim()) {
      toast.error("Informe o nome do proponente");
      return;
    }
    setSaving(true);
    try {
      const isVenda = tipo === "venda";
      const valor = form.valor ? Number(form.valor.replace(/\./g, "").replace(",", ".")) : undefined;
      const dataJson: Record<string, unknown> = {
        imoveis: form.imovel ? [{ endereco: form.imovel }] : [],
      };
      if (isVenda) {
        dataJson.compradores = [{ nome: form.proponente }];
        dataJson.vendedores = [];
        if (valor != null) dataJson.pagamento = { valor_total: valor };
      } else {
        dataJson.locatarios = [{ nome: form.proponente }];
        dataJson.locadores = [];
        if (valor != null) dataJson.locacao = { valor_aluguel: valor };
      }

      const validUntil =
        form.validadeDias && Number(form.validadeDias) > 0
          ? new Date(Date.now() + Number(form.validadeDias) * 86_400_000).toISOString()
          : undefined;

      const signers: Record<string, unknown>[] = [
        {
          role: "proponente",
          name: form.proponente,
          email: form.proponenteEmail || null,
          phone: form.proponenteFone || null,
          notifyChannel: form.proponenteCanal,
          signingGroup: 1,
        },
      ];
      if (form.vendedor.trim()) {
        signers.push({
          role: "vendedor",
          name: form.vendedor,
          email: form.vendedorEmail || null,
          notifyChannel: "email",
          signingGroup: 2,
        });
      }

      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${form.proponente}${form.imovel ? ` — ${form.imovel}` : ""}`,
          schemaType,
          dataJson,
          validUntil,
          signers,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const { proposal } = await res.json();
      toast.success("Proposta criada");
      setOpen(false);
      router.push(`/pipeline/propostas/${proposal.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Nova proposta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova proposta — {tipo === "venda" ? "Vendas" : "Locação"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Proponente</Label>
            <Input
              value={form.proponente}
              onChange={(e) => set("proponente", e.target.value)}
              placeholder="Nome do comprador/locatário"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label>Imóvel</Label>
            <Input
              value={form.imovel}
              onChange={(e) => set("imovel", e.target.value)}
              placeholder="Endereço do imóvel"
            />
          </div>
          {SCHEMA_BY_TIPO[tipo].length > 1 && (
            <div className="space-y-1">
              <Label>Modelo</Label>
              <Select value={schemaType} onValueChange={setSchemaType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEMA_BY_TIPO[tipo].map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{tipo === "venda" ? "Valor (R$)" : "Aluguel (R$/mês)"}</Label>
              <Input
                inputMode="numeric"
                value={form.valor}
                onChange={(e) => set("valor", e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label>Validade (dias)</Label>
              <Input
                inputMode="numeric"
                value={form.validadeDias}
                onChange={(e) => set("validadeDias", e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Criando…" : "Criar rascunho"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
