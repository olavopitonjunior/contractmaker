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
import { UserPlus } from "lucide-react";

const EMPTY = {
  tipoPessoa: "fisica",
  nome: "",
  cpfCnpj: "",
  email: "",
  phone: "",
  rg: "",
  data_nascimento: "",
  renda_mensal: "",
  endereco: "",
  cidade: "",
  uf: "",
};

export function NovoClienteDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  function set(k: keyof typeof EMPTY, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) {
      toast.error("Informe ao menos um nome");
      return;
    }
    setSaving(true);
    try {
      // Campos da ficha (opcionais) vão em dataJson — aditivo, sem shape rígido.
      const dataJson: Record<string, unknown> = {};
      if (form.rg) dataJson.rg = form.rg;
      if (form.data_nascimento) dataJson.data_nascimento = form.data_nascimento;
      if (form.renda_mensal) dataJson.renda_mensal = Number(form.renda_mensal);
      if (form.endereco) dataJson.endereco = form.endereco;
      if (form.cidade) dataJson.cidade = form.cidade;
      if (form.uf) dataJson.uf = form.uf;

      const res = await fetch("/api/locacao/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoPessoa: form.tipoPessoa,
          nome: form.nome,
          cpfCnpj: form.cpfCnpj || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          source: "manual",
          dataJson: Object.keys(dataJson).length ? dataJson : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success("Cliente cadastrado");
      setOpen(false);
      setForm({ ...EMPTY });
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
          <UserPlus className="mr-1 h-4 w-4" />
          Novo cliente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Cadastrar cliente</DialogTitle>
          <DialogDescription>
            Só o nome é obrigatório. Os demais campos espelham o formulário e podem ser preenchidos
            depois — inclusive via importação do CRM.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={form.tipoPessoa} onValueChange={(v) => set("tipoPessoa", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fisica">Pessoa física</SelectItem>
                  <SelectItem value="juridica">Pessoa jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{form.tipoPessoa === "juridica" ? "CNPJ" : "CPF"}</Label>
              <Input value={form.cpfCnpj} onChange={(e) => set("cpfCnpj", e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>{form.tipoPessoa === "juridica" ? "Razão social" : "Nome"} *</Label>
              <Input value={form.nome} onChange={(e) => set("nome", e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            {form.tipoPessoa === "fisica" && (
              <>
                <div className="space-y-1">
                  <Label>RG</Label>
                  <Input value={form.rg} onChange={(e) => set("rg", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Nascimento</Label>
                  <Input type="date" value={form.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Renda mensal (R$)</Label>
                  <Input type="number" step="0.01" value={form.renda_mensal} onChange={(e) => set("renda_mensal", e.target.value)} />
                </div>
              </>
            )}
            <div className="col-span-2 space-y-1">
              <Label>Endereço</Label>
              <Input value={form.endereco} onChange={(e) => set("endereco", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Cidade</Label>
              <Input value={form.cidade} onChange={(e) => set("cidade", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>UF</Label>
              <Input maxLength={2} value={form.uf} onChange={(e) => set("uf", e.target.value.toUpperCase())} />
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
