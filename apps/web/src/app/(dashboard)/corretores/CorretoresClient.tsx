"use client";

/**
 * Tela "Corretores" — lente de cadastro sobre o mesmo registry dos
 * destinatários de split (SplitRecipient kind="commissioner"). A tela de
 * /settings/pagamentos/split-recipients continua como lente financeira
 * (wallet/PIX/split); aqui o foco é o corretor: identificação, contato,
 * preferências de notificação e status de dados pendentes.
 */

import { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  Search,
  Mail,
  MessageCircle,
  BellOff,
  KeyRound,
  Wallet,
} from "lucide-react";

interface Corretor {
  id: string;
  label: string;
  recipientType: "asaas_wallet" | "pix_external";
  walletId: string | null;
  pixAddressKey: string | null;
  pixKeyType: string | null;
  cpfCnpj: string | null;
  tipoPessoa: "fisica" | "juridica" | null;
  creci: string | null;
  papel: string | null;
  email: string | null;
  phone: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankAccountType: string | null;
  bankHolderName: string | null;
  bankHolderDoc: string | null;
  pendingFields: string[];
  active: boolean;
  notifyByEmail: boolean;
  notifyByWhatsapp: boolean;
  notifyOptOut: boolean;
}

const PAPEL_LABEL: Record<string, string> = {
  imobiliaria_principal: "Imobiliária principal",
  captador: "Captador",
  intermediador: "Intermediador",
  indicador: "Indicador",
  outro: "Outro",
};

function maskDoc(doc: string | null): string {
  if (!doc) return "—";
  const d = doc.replace(/\D/g, "");
  if (d.length < 6) return d;
  return `${d.slice(0, 3)}***${d.slice(-2)}`;
}

interface EditState {
  label: string;
  tipoPessoa: "fisica" | "juridica";
  cpfCnpj: string;
  creci: string;
  papel: string;
  email: string;
  phone: string;
  pixAddressKey: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  bankAccountType: string;
  bankHolderName: string;
  bankHolderDoc: string;
  notifyByEmail: boolean;
  notifyByWhatsapp: boolean;
  notifyOptOut: boolean;
}

const EMPTY_EDIT: EditState = {
  label: "",
  tipoPessoa: "fisica",
  cpfCnpj: "",
  creci: "",
  papel: "captador",
  email: "",
  phone: "",
  pixAddressKey: "",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankAccountType: "corrente",
  bankHolderName: "",
  bankHolderDoc: "",
  notifyByEmail: true,
  notifyByWhatsapp: false,
  notifyOptOut: false,
};

export default function CorretoresClient() {
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Corretor | null>(null);
  const [form, setForm] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<Corretor | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/split-recipients?kind=commissioner", {
        credentials: "include",
      });
      if (!res.ok) {
        toast.error("Falha ao carregar corretores");
        return;
      }
      const data = await res.json();
      setCorretores(data.recipients ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return corretores;
    const qDigits = q.replace(/\D/g, "");
    return corretores.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (c.cpfCnpj ?? "").includes(qDigits)) ||
        (c.creci ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
    );
  }, [corretores, query]);

  const ativos = filtered.filter((c) => c.active);
  const pendentes = filtered.filter(
    (c) => !c.active && (c.pendingFields ?? []).length > 0
  );
  const inativos = filtered.filter(
    (c) => !c.active && (c.pendingFields ?? []).length === 0
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_EDIT);
    setOpen(true);
  }

  function openEdit(c: Corretor) {
    setEditing(c);
    setForm({
      label: c.label,
      tipoPessoa: c.tipoPessoa ?? "fisica",
      cpfCnpj: c.cpfCnpj ?? "",
      creci: c.creci ?? "",
      papel: c.papel ?? "captador",
      email: c.email ?? "",
      phone: c.phone ?? "",
      pixAddressKey: c.pixAddressKey ?? "",
      bankName: c.bankName ?? "",
      bankBranch: c.bankBranch ?? "",
      bankAccount: c.bankAccount ?? "",
      bankAccountType: c.bankAccountType ?? "corrente",
      bankHolderName: c.bankHolderName ?? "",
      bankHolderDoc: c.bankHolderDoc ?? "",
      notifyByEmail: c.notifyByEmail,
      notifyByWhatsapp: c.notifyByWhatsapp,
      notifyOptOut: c.notifyOptOut,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.label.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!editing && form.cpfCnpj.replace(/\D/g, "").length < 11) {
      toast.error("CPF/CNPJ é obrigatório no cadastro");
      return;
    }
    setSaving(true);
    try {
      const common = {
        label: form.label.trim(),
        cpfCnpj: form.cpfCnpj.trim() || null,
        tipoPessoa: form.tipoPessoa,
        creci: form.creci.trim() || null,
        papel: form.papel || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        bankName: form.bankName.trim() || null,
        bankBranch: form.bankBranch.trim() || null,
        bankAccount: form.bankAccount.trim() || null,
        bankAccountType: form.bankAccount.trim() ? form.bankAccountType : null,
        bankHolderName: form.bankHolderName.trim() || null,
        bankHolderDoc: form.bankHolderDoc.trim() || null,
        notifyByEmail: form.notifyByEmail,
        notifyByWhatsapp: form.notifyByWhatsapp,
        notifyOptOut: form.notifyOptOut,
      };

      let url = "/api/financeiro/split-recipients";
      let method = "POST";
      let payload: Record<string, unknown>;
      if (editing) {
        url = `/api/financeiro/split-recipients/${editing.id}`;
        method = "PATCH";
        payload = common;
      } else if (form.pixAddressKey.trim()) {
        payload = {
          ...common,
          kind: "commissioner",
          recipientType: "pix_external",
          pixAddressKey: form.pixAddressKey.trim(),
          ownerName: form.label.trim(),
          ownerCpfCnpj: form.cpfCnpj.trim(),
        };
      } else {
        // Sem meio de recebimento: rascunho (pendingFields) — o corretor pode
        // completar depois via magic link ("Pedir dados") ou o admin edita.
        payload = {
          ...common,
          kind: "commissioner",
          recipientType: "asaas_wallet",
          pendingFields: ["walletId"],
        };
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao salvar");
        return;
      }
      toast.success(editing ? "Corretor atualizado" : "Corretor cadastrado");
      setOpen(false);
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function patchNotify(c: Corretor, patch: Partial<Corretor>) {
    const res = await fetch(`/api/financeiro/split-recipients/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao atualizar notificações");
      return;
    }
    setCorretores((prev) =>
      prev.map((r) => (r.id === c.id ? { ...r, ...patch } : r))
    );
  }

  async function deactivate(c: Corretor) {
    const res = await fetch(`/api/financeiro/split-recipients/${c.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao desativar");
      return;
    }
    toast.success("Corretor desativado");
    setConfirmDeactivate(null);
    void load();
  }

  async function reactivate(c: Corretor) {
    const res = await fetch(`/api/financeiro/split-recipients/${c.id}`, {
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
    toast.success("Corretor reativado");
    void load();
  }

  async function requestCompletion(c: Corretor) {
    if (!c.email) {
      toast.error("Cadastre o email do corretor antes de pedir os dados");
      return;
    }
    const res = await fetch(
      `/api/financeiro/split-recipients/${c.id}/request-completion`,
      { method: "POST", credentials: "include" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Falha ao gerar link");
      return;
    }
    toast.success(`Email enviado para ${c.email}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Corretores
          </h1>
          <p className="text-sm text-muted-foreground">
            Cadastro único de corretores parceiros: dados de contato, recebimento
            de comissão e preferências de notificação das atualizações do
            processo. Sem duplicidade — o CPF/CNPJ identifica o corretor.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo corretor
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, CPF/CNPJ, CRECI ou email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {corretores.length === 0 ? (
              <>
                Nenhum corretor cadastrado ainda. Corretores informados nos
                formulários de venda entram aqui automaticamente, ou clique em{" "}
                <b>Novo corretor</b>.
              </>
            ) : (
              "Nenhum corretor encontrado pra esta busca."
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {pendentes.length > 0 && (
            <Section title={`Dados pendentes (${pendentes.length})`} tone="amber">
              {pendentes.map((c) => (
                <CorretorRow
                  key={c.id}
                  c={c}
                  pending
                  onEdit={() => openEdit(c)}
                  onDeactivate={() => setConfirmDeactivate(c)}
                  onRequestCompletion={() => requestCompletion(c)}
                  onNotifyPatch={(patch) => patchNotify(c, patch)}
                />
              ))}
            </Section>
          )}
          {ativos.length > 0 && (
            <Section title={`Ativos (${ativos.length})`}>
              {ativos.map((c) => (
                <CorretorRow
                  key={c.id}
                  c={c}
                  onEdit={() => openEdit(c)}
                  onDeactivate={() => setConfirmDeactivate(c)}
                  onNotifyPatch={(patch) => patchNotify(c, patch)}
                />
              ))}
            </Section>
          )}
          {inativos.length > 0 && (
            <Section title={`Inativos (${inativos.length})`}>
              {inativos.map((c) => (
                <CorretorRow
                  key={c.id}
                  c={c}
                  inactive
                  onEdit={() => openEdit(c)}
                  onReactivate={() => reactivate(c)}
                  onNotifyPatch={(patch) => patchNotify(c, patch)}
                />
              ))}
            </Section>
          )}
        </>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar corretor" : "Novo corretor"}</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 mt-4">
            <div>
              <Label htmlFor="c-label">Nome *</Label>
              <Input
                id="c-label"
                placeholder="Nome do corretor ou razão social"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                maxLength={120}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {(["fisica", "juridica"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, tipoPessoa: t }))}
                      className={`p-2 rounded border text-xs ${
                        form.tipoPessoa === t
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-input"
                      }`}
                    >
                      {t === "fisica" ? "Pessoa física" : "Pessoa jurídica"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="c-doc">
                  {form.tipoPessoa === "juridica" ? "CNPJ" : "CPF"} {editing ? "" : "*"}
                </Label>
                <Input
                  id="c-doc"
                  placeholder="Apenas números"
                  value={form.cpfCnpj}
                  onChange={(e) => setForm((f) => ({ ...f, cpfCnpj: e.target.value }))}
                  maxLength={18}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="c-creci">CRECI</Label>
                <Input
                  id="c-creci"
                  value={form.creci}
                  onChange={(e) => setForm((f) => ({ ...f, creci: e.target.value }))}
                  maxLength={50}
                />
              </div>
              <div>
                <Label htmlFor="c-papel">Papel</Label>
                <select
                  id="c-papel"
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.papel}
                  onChange={(e) => setForm((f) => ({ ...f, papel: e.target.value }))}
                >
                  {Object.entries(PAPEL_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="c-email">Email</Label>
                <Input
                  id="c-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  maxLength={200}
                />
              </div>
              <div>
                <Label htmlFor="c-phone">WhatsApp / telefone</Label>
                <Input
                  id="c-phone"
                  placeholder="+55 11 91234-5678"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  maxLength={30}
                />
              </div>
            </div>

            <div className="border rounded-md p-3 space-y-3">
              <div className="text-sm font-medium">Notificações do processo</div>
              <NotifyToggle
                label="Receber por email"
                checked={form.notifyByEmail}
                onCheckedChange={(v) => setForm((f) => ({ ...f, notifyByEmail: v }))}
              />
              <NotifyToggle
                label="Receber por WhatsApp"
                checked={form.notifyByWhatsapp}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, notifyByWhatsapp: v }))
                }
              />
              <NotifyToggle
                label="Silenciar tudo (opt-out)"
                checked={form.notifyOptOut}
                onCheckedChange={(v) => setForm((f) => ({ ...f, notifyOptOut: v }))}
              />
              <p className="text-xs text-muted-foreground">
                Quais eventos disparam atualização é definido no padrão da
                imobiliária e por venda; aqui é a preferência do corretor.
              </p>
            </div>

            {!editing && (
              <div>
                <Label htmlFor="c-pix">Chave PIX (recebimento — opcional)</Label>
                <Input
                  id="c-pix"
                  placeholder="CPF, CNPJ, email, telefone ou chave aleatória"
                  value={form.pixAddressKey}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pixAddressKey: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Sem chave PIX o cadastro fica com dados de recebimento
                  pendentes — dá pra pedir depois pelo botão &quot;Pedir dados&quot;.
                </p>
              </div>
            )}

            <div className="border rounded-md p-3 space-y-3">
              <div className="text-sm font-medium">Dados bancários (TED — opcional)</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="c-bank">Banco</Label>
                  <Input
                    id="c-bank"
                    value={form.bankName}
                    onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                    maxLength={80}
                  />
                </div>
                <div>
                  <Label htmlFor="c-branch">Agência</Label>
                  <Input
                    id="c-branch"
                    value={form.bankBranch}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bankBranch: e.target.value }))
                    }
                    maxLength={20}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="c-account">Conta</Label>
                  <Input
                    id="c-account"
                    value={form.bankAccount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bankAccount: e.target.value }))
                    }
                    maxLength={30}
                  />
                </div>
                <div>
                  <Label htmlFor="c-acctype">Tipo</Label>
                  <select
                    id="c-acctype"
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    value={form.bankAccountType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bankAccountType: e.target.value }))
                    }
                  >
                    <option value="corrente">Corrente</option>
                    <option value="poupanca">Poupança</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="c-holder">Titular</Label>
                  <Input
                    id="c-holder"
                    value={form.bankHolderName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bankHolderName: e.target.value }))
                    }
                    maxLength={200}
                  />
                </div>
                <div>
                  <Label htmlFor="c-holderdoc">CPF/CNPJ do titular</Label>
                  <Input
                    id="c-holderdoc"
                    value={form.bankHolderDoc}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bankHolderDoc: e.target.value }))
                    }
                    maxLength={18}
                  />
                </div>
              </div>
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
              O corretor deixa de receber notificações e não pode ser usado em
              novas cobranças. O histórico permanece e você pode reativar a
              qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeactivate && deactivate(confirmDeactivate)}
              className="bg-red-600 hover:bg-red-700"
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "amber";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div
        className={`text-xs font-medium uppercase ${
          tone === "amber" ? "text-amber-900" : "text-muted-foreground"
        }`}
      >
        {tone === "amber" ? "⚠️ " : ""}
        {title}
      </div>
      {children}
    </div>
  );
}

function NotifyToggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function CorretorRow({
  c,
  pending,
  inactive,
  onEdit,
  onDeactivate,
  onReactivate,
  onRequestCompletion,
  onNotifyPatch,
}: {
  c: Corretor;
  pending?: boolean;
  inactive?: boolean;
  onEdit: () => void;
  onDeactivate?: () => void;
  onReactivate?: () => void;
  onRequestCompletion?: () => void;
  onNotifyPatch: (patch: Partial<Corretor>) => void;
}) {
  const silenced = c.notifyOptOut;
  return (
    <Card
      className={
        pending ? "border-amber-300 bg-amber-50/40" : inactive ? "opacity-60" : ""
      }
    >
      <CardContent className="flex items-center justify-between p-4 gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{c.label}</span>
            {c.papel && (
              <Badge variant="outline" className="text-xs">
                {PAPEL_LABEL[c.papel] ?? c.papel}
              </Badge>
            )}
            {c.creci && (
              <Badge variant="outline" className="text-xs">
                CRECI {c.creci}
              </Badge>
            )}
            {pending && (
              <Badge
                variant="outline"
                className="text-xs bg-amber-100 border-amber-400 text-amber-900"
              >
                dados de recebimento pendentes
              </Badge>
            )}
            {inactive && (
              <Badge variant="outline" className="text-xs">
                inativo
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="font-mono">{maskDoc(c.cpfCnpj)}</span>
            {c.email && <span>{c.email}</span>}
            {c.phone && <span>{c.phone}</span>}
            <span className="flex items-center gap-1">
              {c.recipientType === "pix_external" ? (
                <>
                  <KeyRound className="h-3 w-3" /> PIX
                </>
              ) : c.walletId ? (
                <>
                  <Wallet className="h-3 w-3" /> Asaas
                </>
              ) : null}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div
            className="flex items-center gap-2"
            title={
              silenced
                ? "Corretor silenciou todas as notificações"
                : "Canais de notificação deste corretor"
            }
          >
            {silenced ? (
              <BellOff className="h-4 w-4 text-red-500" />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onNotifyPatch({ notifyByEmail: !c.notifyByEmail })}
                  title={`Email ${c.notifyByEmail ? "ligado" : "desligado"}`}
                >
                  <Mail
                    className={`h-4 w-4 ${
                      c.notifyByEmail ? "text-green-600" : "text-muted-foreground/40"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onNotifyPatch({ notifyByWhatsapp: !c.notifyByWhatsapp })
                  }
                  title={`WhatsApp ${c.notifyByWhatsapp ? "ligado" : "desligado"}`}
                >
                  <MessageCircle
                    className={`h-4 w-4 ${
                      c.notifyByWhatsapp
                        ? "text-green-600"
                        : "text-muted-foreground/40"
                    }`}
                  />
                </button>
              </>
            )}
          </div>

          <div className="flex gap-1">
            {pending && onRequestCompletion && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRequestCompletion}
                disabled={!c.email}
                title="Enviar link pro corretor completar os dados"
              >
                Pedir dados
              </Button>
            )}
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
        </div>
      </CardContent>
    </Card>
  );
}
