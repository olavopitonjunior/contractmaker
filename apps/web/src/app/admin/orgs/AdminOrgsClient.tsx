"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { MODULE } from "@/lib/modules/catalog";
import {
  KpiCard,
  RangePicker,
  rangeToQuery,
  formatBRL,
  formatUsd,
  formatInt,
  type RangePreset,
} from "@/components/admin/charts";
import { Building2, Users, DollarSign, FileSignature, ScrollText } from "lucide-react";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  subdomain: string | null;
  createdAt: string;
  members: number;
  pipelines: number;
  asaasAccounts: number;
  suspended: boolean;
}

interface TenantMetric {
  orgId: string;
  name: string;
  subdomain: string | null;
  suspended: boolean;
  modules: string[];
  members: number;
  deals: number;
  dealsValueBRL: number;
  activeLeases: number;
  aiCostUsd: number;
  clicksignCostBRL: number;
  asaasVolumeBRL: number;
  certidoesCostBRL: number;
  apiCalls: number;
}

interface OverviewResponse {
  totals: {
    tenants: number;
    suspended: number;
    members: number;
    deals: number;
    activeLeases: number;
    aiCostUsd: number;
    clicksignCostBRL: number;
    asaasVolumeBRL: number;
    certidoesCostBRL: number;
    certidoes: number;
    envelopes: number;
    apiCalls: number;
  };
  /** Custo sem tenant (orgId IS NULL) — embedding da base universal etc. */
  platform: { aiCostUsd: number; aiCalls: number; aiTokens: number };
  perTenant: TenantMetric[];
}

type SortKey =
  | "name"
  | "members"
  | "deals"
  | "dealsValueBRL"
  | "aiCostUsd"
  | "clicksignCostBRL"
  | "asaasVolumeBRL"
  | "certidoesCostBRL";

export function AdminOrgsClient({ orgs, canCreate }: { orgs: OrgRow[]; canCreate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // ── Create org ──
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", subdomain: "", ownerEmail: "", ownerName: "" });
  const [modules, setModules] = useState<Record<string, boolean>>({
    [MODULE.VENDAS]: true,
    [MODULE.LOCACAO]: true,
  });

  // ── Impersonation dialog ──
  const [impersonateOrg, setImpersonateOrg] = useState<OrgRow | null>(null);
  const [reason, setReason] = useState("");

  // Resultado da criação — dialog persistente. A senha temporária é o fallback caso
  // o e-mail de acesso não saia; um toast que some levava a credencial junto.
  const [created, setCreated] = useState<{
    orgName: string;
    ownerEmail: string;
    tempPassword: string | null;
    emailSent: boolean;
  } | null>(null);

  // Aviso do 409 OWNER_ALREADY_IN_ORG — Dialog, não window.confirm (modal nativo
  // trava o driver de browser e o resto da sessão).
  const [ownerWarning, setOwnerWarning] = useState<string | null>(null);

  const submitCreate = useCallback(
    async (confirmExistingUser: boolean) => {
      const selected = Object.entries(modules).filter(([, on]) => on).map(([m]) => m);
      if (selected.length === 0) {
        toast.error("Selecione ao menos um módulo.");
        return;
      }
      setBusy("create");
      try {
        const res = await fetch("/api/admin/orgs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...form,
            ownerName: form.ownerName.trim() || undefined,
            modules: selected,
            ...(confirmExistingUser ? { confirmExistingUser: true } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 409 && data.error === "OWNER_ALREADY_IN_ORG") {
            setOwnerWarning(data.message ?? "O e-mail do owner já pertence a outra organização.");
            return;
          }
          toast.error(data.message ?? data.error ?? "Falha ao criar org");
          return;
        }
        setOwnerWarning(null);
        setCreated({
          orgName: form.name,
          ownerEmail: form.ownerEmail,
          tempPassword: data.owner?.tempPassword ?? null,
          emailSent: data.owner?.emailSent === true,
        });
        setForm({ name: "", subdomain: "", ownerEmail: "", ownerName: "" });
        setModules({ [MODULE.VENDAS]: true, [MODULE.LOCACAO]: true });
        setCreating(false);
        router.refresh();
      } catch {
        toast.error("Falha de rede ao criar a organização.");
      } finally {
        setBusy(null);
      }
    },
    [form, modules, router]
  );

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    await submitCreate(false);
  }

  async function confirmImpersonate() {
    if (!impersonateOrg || reason.trim().length < 3) {
      toast.error("Informe um motivo (mín. 3 caracteres).");
      return;
    }
    setBusy(impersonateOrg.id);
    try {
      const res = await fetch(`/api/admin/orgs/${impersonateOrg.id}/impersonate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao impersonar");
        return;
      }
      toast.success("Testando como o tenant — abrindo o app…");
      // "/" roteia por módulo (tenant só-locação cai em /locacao).
      window.location.href = "/";
    } finally {
      setBusy(null);
    }
  }

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList>
        <TabsTrigger value="overview">Visão geral</TabsTrigger>
        <TabsTrigger value="tenants">Tenants</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <SystemOverview />
      </TabsContent>

      <TabsContent value="tenants" className="space-y-4">
        {canCreate && (
          <div className="rounded-lg border bg-card p-4">
            {!creating ? (
              <Button onClick={() => setCreating(true)}>+ Nova organização</Button>
            ) : (
              <form onSubmit={createOrg} className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="Nome da imobiliária" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                <Input placeholder="subdomínio (ex: imobiliaria-x)" value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value })} required />
                <Input type="email" placeholder="email do owner" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} required />
                <Input placeholder="nome do owner (opcional)" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
                <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                  <span className="text-sm text-muted-foreground">Módulos:</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={modules[MODULE.VENDAS]} onChange={(e) => setModules((m) => ({ ...m, [MODULE.VENDAS]: e.target.checked }))} />
                    Vendas
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={modules[MODULE.LOCACAO]} onChange={(e) => setModules((m) => ({ ...m, [MODULE.LOCACAO]: e.target.checked }))} />
                    Locação
                  </label>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" disabled={busy === "create"}>{busy === "create" ? "Criando…" : "Criar"}</Button>
                  <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button>
                </div>
              </form>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Nome</th>
                <th className="p-3 font-medium">Subdomínio</th>
                <th className="p-3 font-medium">Membros</th>
                <th className="p-3 font-medium">Contas Asaas</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-3 font-medium">
                    <Link href={`/admin/orgs/${o.id}`} className="hover:underline">{o.name}</Link>
                    {o.suspended && <Badge variant="destructive" className="ml-2">suspenso</Badge>}
                  </td>
                  <td className="p-3 text-muted-foreground">{o.subdomain ?? "—"}</td>
                  <td className="p-3">{o.members}</td>
                  <td className="p-3">{o.asaasAccounts}</td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/admin/orgs/${o.id}`}>Detalhe</Link>
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/admin/orgs/${o.id}/modules`}>Módulos</Link>
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === o.id} onClick={() => { setImpersonateOrg(o); setReason(""); }}>
                        Testar como
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <Dialog open={impersonateOrg != null} onOpenChange={(o) => !o && setImpersonateOrg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Testar como {impersonateOrg?.name}</DialogTitle>
            <DialogDescription>
              Você vai operar este tenant como o dono, com as permissões dele. A sessão é auditada (todo AuditLog carimba sua conta) e expira em 8h. Informe o motivo.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Motivo (auditado)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImpersonateOrg(null)}>Cancelar</Button>
            <Button onClick={confirmImpersonate} disabled={busy === impersonateOrg?.id}>
              {busy === impersonateOrg?.id ? "…" : "Testar como"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ownerWarning != null} onOpenChange={(o) => !o && setOwnerWarning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Este e-mail já pertence a outra organização</DialogTitle>
            <DialogDescription>{ownerWarning}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOwnerWarning(null)}>
              Usar outro e-mail
            </Button>
            <Button
              variant="destructive"
              disabled={busy === "create"}
              onClick={() => submitCreate(true)}
            >
              {busy === "create" ? "Criando…" : "Criar assim mesmo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={created != null} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created?.orgName} criada</DialogTitle>
            <DialogDescription>
              {created?.emailSent
                ? `Enviamos para ${created?.ownerEmail} um e-mail com o link para definir a senha (válido por 7 dias). O dono cai direto no guia de primeiros passos.`
                : created?.tempPassword
                  ? `O e-mail de acesso NÃO saiu (provedor recusou — normalmente EMAIL_FROM fora de um domínio verificado no Resend). Entregue a senha abaixo por canal seguro; o dono também pode usar "Esqueci minha senha".`
                  : `${created?.ownerEmail} já tinha conta na plataforma — entra com a senha atual. Nenhum e-mail foi enviado.`}
            </DialogDescription>
          </DialogHeader>

          {created?.tempPassword && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <p className="text-sm text-muted-foreground">
                {created.emailSent
                  ? "Senha temporária (só use se o e-mail não chegar — entregue por canal seguro):"
                  : "Senha temporária — este é o caminho de entrega agora:"}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-background px-2 py-1 font-mono text-sm">
                  {created.tempPassword}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(created.tempPassword!);
                    toast.success("Senha copiada.");
                  }}
                >
                  Copiar
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

// ── System overview tab ───────────────────────────────────────────────────────

function SystemOverview() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "aiCostUsd", dir: "desc" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/metrics/overview?${rangeToQuery(preset)}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Falha ao carregar métricas");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Falha de rede");
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.perTenant].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === "string" ? String(av).localeCompare(String(bv)) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Uso agregado no período {loading && "· carregando…"}
        </p>
        <RangePicker value={preset} onChange={setPreset} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {t && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Tenants" value={formatInt(t.tenants)} sub={`${t.suspended} suspenso(s)`} icon={<Building2 className="h-3.5 w-3.5" />} />
            <KpiCard label="Membros" value={formatInt(t.members)} icon={<Users className="h-3.5 w-3.5" />} />
            <KpiCard label="Negócios" value={formatInt(t.deals)} sub={`${formatInt(t.activeLeases)} locações ativas`} icon={<ScrollText className="h-3.5 w-3.5" />} />
            <KpiCard label="Volume Asaas" value={formatBRL(t.asaasVolumeBRL)} icon={<DollarSign className="h-3.5 w-3.5" />} />
            <KpiCard
              label="Custo IA"
              value={formatUsd(t.aiCostUsd)}
              // O custo de plataforma (orgId IS NULL) era buscado e descartado
              // — o total exibido não era o total.
              sub={
                data?.platform && data.platform.aiCostUsd > 0
                  ? `+ ${formatUsd(data.platform.aiCostUsd)} plataforma`
                  : undefined
              }
              icon={<DollarSign className="h-3.5 w-3.5" />}
            />
            <KpiCard label="Custo ClickSign" value={formatBRL(t.clicksignCostBRL)} sub={`${formatInt(t.envelopes)} envelopes`} icon={<FileSignature className="h-3.5 w-3.5" />} />
            <KpiCard label="Custo Certidões" value={formatBRL(t.certidoesCostBRL)} sub={`${formatInt(t.certidoes)} consultas`} icon={<DollarSign className="h-3.5 w-3.5" />} />
            <KpiCard label="Chamadas de API" value={formatInt(t.apiCalls)} icon={<Building2 className="h-3.5 w-3.5" />} />
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  {([
                    ["name", "Tenant"],
                    ["members", "Membros"],
                    ["deals", "Negócios"],
                    ["dealsValueBRL", "Valor (R$)"],
                    ["asaasVolumeBRL", "Asaas (R$)"],
                    ["aiCostUsd", "IA (US$)"],
                    ["clicksignCostBRL", "ClickSign (R$)"],
                    ["certidoesCostBRL", "Certidões (R$)"],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th key={key} className="cursor-pointer p-3 font-medium hover:text-foreground" onClick={() => toggleSort(key)}>
                      {label} {sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.orgId} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">
                      <Link href={`/admin/orgs/${r.orgId}`} className="hover:underline">{r.name}</Link>
                      {r.suspended && <Badge variant="destructive" className="ml-2">suspenso</Badge>}
                      <div className="text-[10px] text-muted-foreground">{r.modules.join(" · ") || "sem módulos"}</div>
                    </td>
                    <td className="p-3 tabular-nums">{formatInt(r.members)}</td>
                    <td className="p-3 tabular-nums">{formatInt(r.deals)}</td>
                    <td className="p-3 tabular-nums">{formatBRL(r.dealsValueBRL)}</td>
                    <td className="p-3 tabular-nums">{formatBRL(r.asaasVolumeBRL)}</td>
                    <td className="p-3 tabular-nums">{formatUsd(r.aiCostUsd)}</td>
                    <td className="p-3 tabular-nums">{formatBRL(r.clicksignCostBRL)}</td>
                    <td className="p-3 tabular-nums">{formatBRL(r.certidoesCostBRL)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
