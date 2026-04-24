"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Save } from "lucide-react";

interface Recipient {
  id: string;
  label: string;
  walletId: string;
  cpfCnpj: string | null;
  description: string | null;
  active: boolean;
  createdAt: string;
}

function maskWallet(w: string) {
  if (w.length <= 12) return w;
  return `${w.slice(0, 8)}…${w.slice(-4)}`;
}

export default function SplitRecipientsClient() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [label, setLabel] = useState("");
  const [walletId, setWalletId] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/split-recipients", {
        credentials: "include",
      });
      if (!res.ok) {
        toast.error("Falha ao carregar recipients");
        return;
      }
      const data = await res.json();
      setRecipients(data.recipients ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditing(null);
    setLabel("");
    setWalletId("");
    setCpfCnpj("");
    setDescription("");
    setOpen(true);
  }

  function openEdit(r: Recipient) {
    setEditing(r);
    setLabel(r.label);
    setWalletId(r.walletId);
    setCpfCnpj(r.cpfCnpj ?? "");
    setDescription(r.description ?? "");
    setOpen(true);
  }

  async function save() {
    if (!label.trim() || !walletId.trim()) {
      toast.error("Rótulo e Wallet ID são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const body = {
        label: label.trim(),
        walletId: walletId.trim(),
        cpfCnpj: cpfCnpj.trim() === "" ? null : cpfCnpj.trim(),
        description: description.trim() === "" ? null : description.trim(),
      };
      const url = editing
        ? `/api/financeiro/split-recipients/${editing.id}`
        : "/api/financeiro/split-recipients";
      const method = editing ? "PATCH" : "POST";
      // PATCH não aceita walletId — é imutável
      const payload = editing
        ? {
            label: body.label,
            cpfCnpj: body.cpfCnpj,
            description: body.description,
          }
        : body;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao salvar");
        return;
      }
      toast.success(editing ? "Recipient atualizado" : "Recipient criado");
      setOpen(false);
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: Recipient) {
    if (!confirm(`Desativar "${r.label}"? Splits já criados não são afetados.`)) {
      return;
    }
    const res = await fetch(`/api/financeiro/split-recipients/${r.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao desativar");
      return;
    }
    toast.success("Recipient desativado");
    void load();
  }

  async function reactivate(r: Recipient) {
    const res = await fetch(`/api/financeiro/split-recipients/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ active: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao reativar");
      return;
    }
    toast.success("Recipient reativado");
    void load();
  }

  const active = recipients.filter((r) => r.active);
  const inactive = recipients.filter((r) => !r.active);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Destinatários de split</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre wallets que podem receber repasse em cobranças desta organização.
            Use no form de nova cobrança para dividir o valor entre múltiplas partes.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo destinatário
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : recipients.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum destinatário cadastrado ainda. Clique em{" "}
            <b>Novo destinatário</b> para começar.
          </CardContent>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase">
                Ativos ({active.length})
              </div>
              {active.map((r) => (
                <RecipientRow
                  key={r.id}
                  r={r}
                  onEdit={() => openEdit(r)}
                  onDeactivate={() => remove(r)}
                />
              ))}
            </div>
          )}
          {inactive.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase">
                Inativos ({inactive.length})
              </div>
              {inactive.map((r) => (
                <RecipientRow
                  key={r.id}
                  r={r}
                  inactive
                  onEdit={() => openEdit(r)}
                  onReactivate={() => reactivate(r)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar destinatário" : "Novo destinatário"}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-4 mt-4">
            <div>
              <Label htmlFor="label">Rótulo *</Label>
              <Input
                id="label"
                placeholder="Ex: Corretora ABC"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
              />
            </div>
            <div>
              <Label htmlFor="walletId">Wallet ID do Asaas *</Label>
              <Input
                id="walletId"
                placeholder="Ex: 80cd2f34-7a1b-4c85-9d12-abc1234def56"
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
                disabled={!!editing}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {editing
                  ? "Wallet ID é imutável após criado. Crie um novo destinatário se precisar trocar."
                  : "O wallet ID de uma conta Asaas (subconta ou master). Consulte no painel Asaas."}
              </p>
            </div>
            <div>
              <Label htmlFor="cpfCnpj">CPF/CNPJ (opcional)</Label>
              <Input
                id="cpfCnpj"
                placeholder="Apenas metadado — não enviado ao Asaas"
                value={cpfCnpj}
                onChange={(e) => setCpfCnpj(e.target.value)}
                maxLength={18}
              />
            </div>
            <div>
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Textarea
                id="description"
                placeholder="Notas internas sobre este destinatário"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-6">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RecipientRow({
  r,
  inactive,
  onEdit,
  onDeactivate,
  onReactivate,
}: {
  r: Recipient;
  inactive?: boolean;
  onEdit: () => void;
  onDeactivate?: () => void;
  onReactivate?: () => void;
}) {
  return (
    <Card className={inactive ? "opacity-60" : ""}>
      <CardContent className="flex items-center justify-between p-4 gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{r.label}</span>
            {inactive && (
              <Badge variant="outline" className="text-xs">
                inativo
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1">
            {maskWallet(r.walletId)}
          </div>
          {r.description && (
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {r.description}
            </div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={onEdit} title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          {inactive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReactivate}
              className="text-green-700"
            >
              Reativar
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDeactivate}
              title="Desativar"
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
