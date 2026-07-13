"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, User } from "lucide-react";

export interface ClienteFicha {
  id: string;
  tipoPessoa: string;
  nome: string;
  cpfCnpj: string;
  email: string;
  phone: string;
  status: string;
  createdByName: string;
  createdAt: string;
}

const STATUS_OPTIONS = [
  "novo",
  "em_analise",
  "aprovado",
  "reprovado",
  "convertido",
  "arquivado",
] as const;

const STATUS_LABEL: Record<string, string> = {
  novo: "Novo",
  em_analise: "Em análise",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  convertido: "Convertido",
  arquivado: "Arquivado",
};

export function ClienteFichaCard({ ficha }: { ficha: ClienteFicha }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nome: ficha.nome,
    cpfCnpj: ficha.cpfCnpj,
    email: ficha.email,
    phone: ficha.phone,
    status: ficha.status,
  });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/locacao/clients/${ficha.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: form.nome,
          cpfCnpj: form.cpfCnpj || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          status: form.status,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success("Ficha atualizada");
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base flex items-center gap-2">
          <User className="h-4 w-4" /> Ficha do cliente
        </CardTitle>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4 mr-1.5" /> Editar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{ficha.tipoPessoa === "juridica" ? "CNPJ" : "CPF"}</Label>
              <Input value={form.cpfCnpj} onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>E-mail</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Documento</dt>
              <dd>{ficha.cpfCnpj || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <Badge variant="outline">{STATUS_LABEL[ficha.status] ?? ficha.status}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Telefone</dt>
              <dd>{ficha.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">E-mail</dt>
              <dd className="truncate">{ficha.email || "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Cadastrado por</dt>
              <dd>{ficha.createdByName}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
