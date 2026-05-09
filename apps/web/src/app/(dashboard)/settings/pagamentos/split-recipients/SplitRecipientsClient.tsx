"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Save, Wallet, KeyRound, Upload, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

  const [confirmDeactivate, setConfirmDeactivate] = useState<Recipient | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findItems, setFindItems] = useState<
    Array<{
      cpfCnpj: string;
      nome: string;
      cpf?: string;
      cnpj?: string;
      email?: string;
      mobile_phone?: string;
      seenInDeals: string[];
    }>
  >([]);
  const [findLoading, setFindLoading] = useState(false);

  async function submitBulk() {
    setBulkSubmitting(true);
    try {
      const lines = bulkText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));
      const rows: Array<{
        nome: string;
        cpfCnpj: string;
        tipo: "wallet" | "pix";
        walletOuChave: string;
        label?: string;
        email?: string;
      }> = [];
      for (const line of lines) {
        const parts = line.split(",").map((p) => p.trim());
        if (parts.length < 4) continue;
        const [nome, cpfCnpj, tipo, walletOuChave, label, email] = parts;
        if (tipo !== "wallet" && tipo !== "pix") continue;
        rows.push({
          nome,
          cpfCnpj,
          tipo: tipo as "wallet" | "pix",
          walletOuChave,
          label: label || undefined,
          email: email || undefined,
        });
      }
      if (rows.length === 0) {
        toast.error("Nenhuma linha válida no CSV");
        return;
      }
      const res = await fetch("/api/financeiro/split-recipients/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha");
        return;
      }
      toast.success(
        `${data.created.length} criado(s)${data.errors.length > 0 ? `, ${data.errors.length} erro(s)` : ""}`
      );
      if (data.errors.length > 0) {
        console.warn("[bulk-import] erros:", data.errors);
      }
      setBulkOpen(false);
      setBulkText("");
      void load();
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function loadFindUncadastrados() {
    setFindLoading(true);
    try {
      const res = await fetch("/api/financeiro/split-recipients/uncadastrados", {
        credentials: "include",
      });
      if (!res.ok) {
        toast.error("Falha ao buscar comissionados");
        return;
      }
      const data = await res.json();
      setFindItems(data.items ?? []);
    } finally {
      setFindLoading(false);
    }
  }

  function startCreateFromUncadastrado(item: {
    nome: string;
    cpf?: string;
    cnpj?: string;
    email?: string;
  }) {
    setEditing(null);
    setRecipientType("pix_external");
    setLabel(item.nome);
    setOwnerName(item.nome);
    const doc = item.cpf || item.cnpj || "";
    setOwnerCpfCnpj(doc);
    setCpfCnpj(doc);
    setPixAddressKey("");
    setWalletId("");
    setDescription("");
    setFindOpen(false);
    setOpen(true);
  }

  async function remove(r: Recipient) {
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
    setConfirmDeactivate(null);
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
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => {
              setFindOpen(true);
              void loadFindUncadastrados();
            }}
          >
            <Search className="h-4 w-4 mr-1" /> Buscar comissionados sem cadastro
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> Importar em lote
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Novo destinatário
          </Button>
        </div>
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
                  onDeactivate={() => setConfirmDeactivate(r)}
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

      <AlertDialog
        open={confirmDeactivate !== null}
        onOpenChange={(o) => !o && setConfirmDeactivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Desativar &ldquo;{confirmDeactivate?.label}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cobranças futuras não poderão usar este destinatário. Splits já
              criados continuam disparando normalmente. Você pode reativar a
              qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeactivate && remove(confirmDeactivate)}
              className="bg-red-600 hover:bg-red-700"
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar destinatários em lote</DialogTitle>
            <DialogDescription>
              Cole CSV com formato:{" "}
              <code className="text-xs">
                nome, cpf_cnpj, tipo, wallet_ou_chave, label?, email?
              </code>
              <br />
              Onde <code>tipo</code> é <code>wallet</code> ou <code>pix</code>.
              Linhas começando com <code>#</code> são ignoradas.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            placeholder={`# nome, cpf_cnpj, tipo, wallet_ou_chave, label, email\nMaria Silva, 12345678900, pix, maria@email.com, Corretora Maria, maria@email.com\nImobiliária X, 12345678000100, wallet, abc123-uuid, , contato@imobx.com`}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkSubmitting}>
              Cancelar
            </Button>
            <Button onClick={submitBulk} disabled={bulkSubmitting || bulkText.trim().length === 0}>
              {bulkSubmitting ? "Importando..." : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={findOpen} onOpenChange={setFindOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Comissionados sem cadastro (últimos 90 dias)</DialogTitle>
            <DialogDescription>
              Lista de pessoas que aparecem em <code>comissao.comissionados[]</code>{" "}
              de contratos recentes mas ainda não estão cadastradas como destinatário.
              Cadastre individualmente para que possam receber repasse.
            </DialogDescription>
          </DialogHeader>
          {findLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : findItems.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Nada para cadastrar — todos os comissionados extraídos nos últimos 90 dias
              já têm destinatário ativo.
            </p>
          ) : (
            <div className="space-y-2">
              {findItems.map((it) => (
                <div
                  key={it.cpfCnpj}
                  className="border rounded p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{it.nome}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {it.cpf || it.cnpj || it.cpfCnpj}
                      {it.email ? ` · ${it.email}` : ""}
                    </div>
                    {it.seenInDeals.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {it.seenInDeals.slice(0, 2).join(", ")}
                        {it.seenInDeals.length > 2 && ` +${it.seenInDeals.length - 2}`}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => startCreateFromUncadastrado(it)}
                  >
                    Cadastrar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
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
