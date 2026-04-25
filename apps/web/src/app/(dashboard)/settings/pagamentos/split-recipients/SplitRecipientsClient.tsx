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
import { Plus, Pencil, Trash2, Save, Wallet, KeyRound } from "lucide-react";

type RecipientType = "asaas_wallet" | "pix_external";

interface Recipient {
  id: string;
  label: string;
  recipientType: RecipientType;
  walletId: string | null;
  pixAddressKey: string | null;
  pixKeyType: string | null;
  ownerName: string | null;
  ownerCpfCnpj: string | null;
  cpfCnpj: string | null;
  description: string | null;
  active: boolean;
  createdAt: string;
}

function maskWallet(w: string) {
  if (w.length <= 12) return w;
  return `${w.slice(0, 8)}…${w.slice(-4)}`;
}

function maskPixKey(key: string, type: string | null) {
  if (type === "EMAIL" && key.includes("@")) {
    const [local, domain] = key.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (type === "CPF" || type === "CNPJ") {
    const digits = key.replace(/\D/g, "");
    return `***${digits.slice(-4)}`;
  }
  if (type === "PHONE") {
    return `***${key.slice(-4)}`;
  }
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}

export default function SplitRecipientsClient() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [recipientType, setRecipientType] = useState<RecipientType>("pix_external");
  const [label, setLabel] = useState("");
  const [walletId, setWalletId] = useState("");
  const [pixAddressKey, setPixAddressKey] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerCpfCnpj, setOwnerCpfCnpj] = useState("");
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
        toast.error("Falha ao carregar destinatários");
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
    setRecipientType("pix_external");
    setLabel("");
    setWalletId("");
    setPixAddressKey("");
    setOwnerName("");
    setOwnerCpfCnpj("");
    setCpfCnpj("");
    setDescription("");
    setOpen(true);
  }

  function openEdit(r: Recipient) {
    setEditing(r);
    setRecipientType(r.recipientType);
    setLabel(r.label);
    setWalletId(r.walletId ?? "");
    setPixAddressKey(r.pixAddressKey ?? "");
    setOwnerName(r.ownerName ?? "");
    setOwnerCpfCnpj(r.ownerCpfCnpj ?? "");
    setCpfCnpj(r.cpfCnpj ?? "");
    setDescription(r.description ?? "");
    setOpen(true);
  }

  async function save() {
    if (!label.trim()) {
      toast.error("Rótulo é obrigatório");
      return;
    }
    if (recipientType === "asaas_wallet" && !walletId.trim() && !editing) {
      toast.error("Wallet ID é obrigatório");
      return;
    }
    if (recipientType === "pix_external" && !editing) {
      if (!pixAddressKey.trim()) {
        toast.error("Chave PIX é obrigatória");
        return;
      }
      if (!ownerName.trim()) {
        toast.error("Nome do beneficiário é obrigatório");
        return;
      }
      if (!ownerCpfCnpj.trim()) {
        toast.error("CPF/CNPJ do beneficiário é obrigatório");
        return;
      }
    }

    setSaving(true);
    try {
      // POST aceita os campos de tipo; PATCH só edita label/cpfCnpj/description/active.
      const payload: Record<string, unknown> = editing
        ? {
            label: label.trim(),
            cpfCnpj: cpfCnpj.trim() === "" ? null : cpfCnpj.trim(),
            description: description.trim() === "" ? null : description.trim(),
          }
        : recipientType === "asaas_wallet"
          ? {
              recipientType,
              label: label.trim(),
              walletId: walletId.trim(),
              cpfCnpj: cpfCnpj.trim() === "" ? null : cpfCnpj.trim(),
              description: description.trim() === "" ? null : description.trim(),
            }
          : {
              recipientType,
              label: label.trim(),
              pixAddressKey: pixAddressKey.trim(),
              ownerName: ownerName.trim(),
              ownerCpfCnpj: ownerCpfCnpj.trim(),
              cpfCnpj: cpfCnpj.trim() === "" ? null : cpfCnpj.trim(),
              description: description.trim() === "" ? null : description.trim(),
            };

      const url = editing
        ? `/api/financeiro/split-recipients/${editing.id}`
        : "/api/financeiro/split-recipients";
      const method = editing ? "PATCH" : "POST";
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
      toast.success(editing ? "Destinatário atualizado" : "Destinatário criado");
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
    toast.success("Destinatário desativado");
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
    toast.success("Destinatário reativado");
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
            Cadastre beneficiários que podem receber repasse em cobranças. Eles
            podem ter conta Asaas (split nativo, instantâneo) ou só PIX em outro
            banco (transferência automática após o pagamento).
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
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar destinatário" : "Novo destinatário"}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-4 mt-4">
            {!editing && (
              <div>
                <Label>Tipo de destinatário</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setRecipientType("pix_external")}
                    className={`p-3 rounded border text-left text-sm ${
                      recipientType === "pix_external"
                        ? "border-primary bg-primary/5"
                        : "border-input"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <KeyRound className="h-4 w-4" />
                      PIX externo
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Beneficiário recebe via PIX em outro banco. Transferência
                      automática após pagamento (~R$ 1 de taxa).
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecipientType("asaas_wallet")}
                    className={`p-3 rounded border text-left text-sm ${
                      recipientType === "asaas_wallet"
                        ? "border-primary bg-primary/5"
                        : "border-input"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Wallet className="h-4 w-4" />
                      Conta Asaas
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Beneficiário tem conta Asaas. Split nativo, gratuito e
                      instantâneo.
                    </div>
                  </button>
                </div>
              </div>
            )}

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

            {recipientType === "asaas_wallet" ? (
              <div>
                <Label htmlFor="walletId">Wallet ID Asaas *</Label>
                <Input
                  id="walletId"
                  placeholder="80cd2f34-7a1b-4c85-9d12-abc1234def56"
                  value={walletId}
                  onChange={(e) => setWalletId(e.target.value)}
                  disabled={!!editing}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {editing
                    ? "Wallet ID é imutável após criado."
                    : "Wallet ID Asaas do beneficiário (consulte no painel dele)."}
                </p>
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="pixKey">Chave PIX *</Label>
                  <Input
                    id="pixKey"
                    placeholder="CPF, CNPJ, email, telefone ou chave aleatória"
                    value={pixAddressKey}
                    onChange={(e) => setPixAddressKey(e.target.value)}
                    disabled={!!editing}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {editing
                      ? "Chave PIX é imutável após criado."
                      : "Aceitamos CPF (11 dígitos), CNPJ (14), email, telefone (+55…) ou chave aleatória (UUID)."}
                  </p>
                </div>
                <div>
                  <Label htmlFor="ownerName">Nome do beneficiário *</Label>
                  <Input
                    id="ownerName"
                    placeholder="Nome completo (do CPF/CNPJ vinculado à chave PIX)"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    disabled={!!editing}
                  />
                </div>
                <div>
                  <Label htmlFor="ownerCpfCnpj">CPF/CNPJ do beneficiário *</Label>
                  <Input
                    id="ownerCpfCnpj"
                    placeholder="CPF (11) ou CNPJ (14) — apenas números"
                    value={ownerCpfCnpj}
                    onChange={(e) => setOwnerCpfCnpj(e.target.value)}
                    disabled={!!editing}
                    maxLength={18}
                  />
                </div>
              </>
            )}

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
  const isPix = r.recipientType === "pix_external";
  return (
    <Card className={inactive ? "opacity-60" : ""}>
      <CardContent className="flex items-center justify-between p-4 gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{r.label}</span>
            <Badge variant="outline" className="text-xs gap-1">
              {isPix ? (
                <>
                  <KeyRound className="h-3 w-3" /> PIX externo
                </>
              ) : (
                <>
                  <Wallet className="h-3 w-3" /> Conta Asaas
                </>
              )}
            </Badge>
            {inactive && (
              <Badge variant="outline" className="text-xs">
                inativo
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1">
            {isPix
              ? `${r.pixKeyType} · ${maskPixKey(r.pixAddressKey ?? "", r.pixKeyType)}`
              : maskWallet(r.walletId ?? "")}
          </div>
          {isPix && r.ownerName && (
            <div className="text-xs text-muted-foreground mt-1">
              {r.ownerName}
            </div>
          )}
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
