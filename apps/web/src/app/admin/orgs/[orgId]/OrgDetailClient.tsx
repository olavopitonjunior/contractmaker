"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  KpiCard,
  DistBars,
  LineChart,
  RangePicker,
  rangeToQuery,
  formatBRL,
  formatUsd,
  formatInt,
  formatBytes,
  type RangePreset,
} from "@/components/admin/charts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Metrics = any;

function countsOf(rec: Record<string, { count: number }> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec ?? {})) out[k] = v.count;
  return out;
}

export function OrgDetailClient({
  orgId,
  orgName,
  subdomain,
  initialSuspended,
  canManage,
}: {
  orgId: string;
  orgName: string;
  subdomain: string | null;
  initialSuspended: boolean;
  canManage: boolean;
}) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/metrics?${rangeToQuery(preset)}`);
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
  }, [orgId, preset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{loading ? "Carregando…" : "Métricas no período"}</p>
        <RangePicker value={preset} onChange={setPreset} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="vendas">Vendas</TabsTrigger>
          <TabsTrigger value="locacao">Locação</TabsTrigger>
          <TabsTrigger value="contratos">Contratos</TabsTrigger>
          <TabsTrigger value="conhecimento">Conhecimento</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
          <TabsTrigger value="acoes">Ações</TabsTrigger>
        </TabsList>

        {data && (
          <>
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard label="Membros" value={formatInt(data.members.byRole ? sumRecord(data.members.byRole) : 0)} sub={`${data.members.activeLast30d} ativos (30d)`} />
                <KpiCard label="Negócios" value={formatInt(data.sales.deals.total)} sub={formatBRL(data.sales.deals.valueBRL)} />
                <KpiCard label="Locações" value={formatInt(sumRecord(countsOf(data.locacao.leasesByStatus)))} />
                <KpiCard label="Custo IA" value={formatUsd(data.ai.totals.costUsd)} sub={`${formatInt(data.ai.totals.calls)} chamadas`} />
                <KpiCard label="ClickSign" value={formatBRL(data.integrations.clicksign.costBRLInRange)} sub={`${data.integrations.clicksign.envelopesInRange} envelopes`} />
                <KpiCard label="Volume Asaas" value={formatBRL(data.integrations.asaas.volumeBRLInRange)} sub={`${data.integrations.asaas.chargesInRange} cobranças`} />
                <KpiCard label="Certidões" value={formatBRL(certCost(data))} />
                <KpiCard label="Storage" value={formatBytes(data.storage.totalBytes)} />
              </div>
              <Card>
                <CardHeader><CardTitle className="text-sm">Custo de IA por dia (US$)</CardTitle></CardHeader>
                <CardContent>
                  <LineChart data={data.ai.byDay.map((d: any) => ({ date: d.date, value: d.value, count: d.count }))} valueFormat={formatUsd} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="vendas" className="grid gap-4 md:grid-cols-2">
              <Section title="Formulários por status"><DistBars record={data.sales.formsByStatus} /></Section>
              <Section title="Leads por status"><DistBars record={data.sales.leadsByStatus} /></Section>
              <Section title={`Funil de vendas · ${formatBRL(data.sales.deals.valueBRL)}`}>
                <DistBars record={stageRecord(data.sales.deals.byStage)} displayByKey={(k, v) => formatInt(v)} />
              </Section>
            </TabsContent>

            <TabsContent value="locacao" className="grid gap-4 md:grid-cols-2">
              <Section title="Imóveis por status"><DistBars record={data.locacao.propertiesByStatus} /></Section>
              <Section title="Contratos de locação por status"><DistBars record={countsOf(data.locacao.leasesByStatus)} /></Section>
              <Section title="Cobranças de aluguel por status"><DistBars record={countsOf(data.locacao.rentChargesByStatus)} /></Section>
              <Section title="Funil de locação"><DistBars record={stageRecord(data.locacao.dealsByStage)} /></Section>
            </TabsContent>

            <TabsContent value="contratos" className="grid gap-4 md:grid-cols-2">
              <Section title="Contratos por status"><DistBars record={data.contracts.byStatus} /></Section>
              <Section title="Contratos por tipo"><DistBars record={data.contracts.byKind} /></Section>
              <Section title="Templates"><p className="text-2xl font-semibold tabular-nums">{formatInt(data.contracts.templates)}</p></Section>
            </TabsContent>

            <TabsContent value="conhecimento" className="grid gap-4 md:grid-cols-2">
              <Section title="Base de conhecimento por categoria"><DistBars record={data.knowledge.byCategory} /></Section>
              <Section title="Propostas de cláusula por status"><DistBars record={data.knowledge.clauseProposalsByStatus} /></Section>
              <Section title="Sugestões de template por status"><DistBars record={data.knowledge.templateSuggestionsByStatus} /></Section>
            </TabsContent>

            <TabsContent value="integracoes" className="grid gap-4 md:grid-cols-2">
              <Section title={`ClickSign · ${formatBRL(data.integrations.clicksign.costBRLInRange)} no período`}>
                <DistBars record={data.integrations.clicksign.byStatus} />
              </Section>
              <Section title={`Asaas · ${formatBRL(data.integrations.asaas.volumeBRLInRange)} cobrado`}>
                <div className="space-y-3">
                  <div><p className="mb-1 text-xs text-muted-foreground">Contas</p><DistBars record={data.integrations.asaas.accountsByStatus} /></div>
                  <div><p className="mb-1 text-xs text-muted-foreground">Cobranças por status</p><DistBars record={countsOf(data.integrations.asaas.chargesByStatus)} /></div>
                  <div><p className="mb-1 text-xs text-muted-foreground">Transferências por status</p><DistBars record={countsOf(data.integrations.asaas.transfersByStatus)} /></div>
                </div>
              </Section>
              <Section title="Certidões por status"><DistBars record={data.integrations.certidoes.byStatus} /></Section>
              <Section title="Certidões por provedor">
                <div className="space-y-2">
                  {data.integrations.certidoes.byProvider.map((p: any) => (
                    <div key={p.provider} className="flex items-center justify-between text-sm">
                      <span>{p.provider}</span>
                      <span className="tabular-nums text-muted-foreground">{formatInt(p.count)} · {formatBRL(p.costBRL)}</span>
                    </div>
                  ))}
                  {data.integrations.certidoes.byProvider.length === 0 && <p className="text-xs text-muted-foreground">Sem dados.</p>}
                </div>
              </Section>
              <Section title="IA por operação">
                <DistBars record={Object.fromEntries(data.ai.byOperation.map((o: any) => [o.key, o.costUsd]))} displayByKey={(_k, v) => formatUsd(v)} />
              </Section>
              <Section title="IA por provedor">
                <DistBars record={Object.fromEntries(data.ai.byProvider.map((o: any) => [o.key, o.costUsd]))} displayByKey={(_k, v) => formatUsd(v)} />
              </Section>
            </TabsContent>

            <TabsContent value="storage" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard label="Total" value={formatBytes(data.storage.totalBytes)} />
                <KpiCard label="Anexos de deal" value={formatBytes(data.storage.deal.bytes)} sub={`${data.storage.deal.count} arquivos`} />
                <KpiCard label="Anexos de form" value={formatBytes(data.storage.form.bytes)} sub={`${data.storage.form.count} arquivos`} />
                <KpiCard label="Chat + exports" value={formatBytes(data.storage.chat.bytes + data.storage.export.bytes)} sub={`${data.storage.chat.count + data.storage.export.count} arquivos`} />
              </div>
              <p className="text-xs text-muted-foreground">
                Tamanho medido a partir do upload (forward-only) — anexos antigos não têm byte size e não contam aqui.
              </p>
            </TabsContent>

            <TabsContent value="auditoria" className="grid gap-4 md:grid-cols-2">
              <Section title="Ações no período"><DistBars record={data.audit.byAction} /></Section>
              <Section title="Resultado"><DistBars record={data.audit.byResult} /></Section>
              <Card className="md:col-span-2">
                <CardHeader><CardTitle className="text-sm">Eventos recentes</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-xs">
                    {data.audit.recent.map((a: any) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 border-b py-1 last:border-0">
                        <span className="truncate"><span className="font-medium">{a.action}</span> · {a.resourceType ?? "—"}</span>
                        <span className="shrink-0 text-muted-foreground">{a.result} · {new Date(a.createdAt).toLocaleString("pt-BR")}</span>
                      </li>
                    ))}
                    {data.audit.recent.length === 0 && <li className="text-muted-foreground">Sem eventos no período.</li>}
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="acoes">
              <ActionsPanel
                orgId={orgId}
                orgName={orgName}
                subdomain={subdomain}
                initialSuspended={initialSuspended}
                canManage={canManage}
              />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function sumRecord(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}
function stageRecord(stages: Array<{ stage: string; count: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of stages) out[s.stage] = s.count;
  return out;
}
function certCost(data: Metrics): number {
  return (data.integrations.certidoes.byProvider as Array<{ costBRL: number }>).reduce(
    (a, p) => a + p.costBRL,
    0
  );
}

// ── Ações ─────────────────────────────────────────────────────────────────────

function ActionsPanel({
  orgId,
  orgName,
  subdomain,
  initialSuspended,
  canManage,
}: {
  orgId: string;
  orgName: string;
  subdomain: string | null;
  initialSuspended: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [suspended, setSuspended] = useState(initialSuspended);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Ações disponíveis apenas para super_admin.</p>;
  }

  async function toggleSuspend() {
    setBusy("suspend");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/suspend`, {
        method: suspended ? "DELETE" : "POST",
      });
      if (!res.ok) {
        toast.error("Falha ao alterar suspensão");
        return;
      }
      setSuspended(!suspended);
      toast.success(suspended ? "Tenant reativado" : "Tenant suspenso");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function doDelete() {
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: confirmText.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.message ?? d.error ?? "Falha ao excluir");
        return;
      }
      toast.success("Tenant excluído.");
      window.location.href = "/admin/orgs";
    } finally {
      setBusy(null);
    }
  }

  async function resendOwnerAccess() {
    setBusy("resend");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/resend-owner-access`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.message ?? d.error ?? "Falha ao reenviar o acesso");
        return;
      }
      toast.success(`E-mail de acesso enviado para ${d.sentTo}.`);
    } catch {
      toast.error("Falha de rede.");
    } finally {
      setBusy(null);
    }
  }

  async function seedClauses() {
    setBusy("seed-clauses");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/seed-clauses`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.message ?? d.error ?? "Falha ao semear cláusulas");
        return;
      }
      toast.success(`Cláusulas semeadas: ${d.created} criadas, ${d.skipped} já existiam.`);
    } catch {
      toast.error("Falha de rede.");
    } finally {
      setBusy(null);
    }
  }

  async function resetOnboarding() {
    setBusy("reset-onboarding");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/reset-onboarding`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.message ?? d.error ?? "Falha ao reabrir o onboarding");
        return;
      }
      // Os 6 passos derivam dos dados: se já estão todos cumpridos, o checklist
      // se re-encerra sozinho no próximo carregamento — avisar em vez de mentir.
      if (d.alreadyComplete) {
        toast.warning("Onboarding reaberto, mas os 6 passos já estão cumpridos — o guia vai se encerrar de novo sozinho.");
      } else {
        toast.success(`Onboarding reaberto. Passos pendentes: ${(d.pendingSteps ?? []).join(", ")}.`);
      }
      router.refresh();
    } catch {
      toast.error("Falha de rede.");
    } finally {
      setBusy(null);
    }
  }

  const expectedConfirm = subdomain ?? orgName;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Button variant="outline" asChild><Link href={`/admin/orgs/${orgId}/modules`}>Gerenciar módulos</Link></Button>
        <Button variant="outline" asChild><Link href="/admin/platform-roles">Gerenciar staff de plataforma</Link></Button>
        <BrandingFeesEditor orgId={orgId} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Acesso do dono</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Reenvia ao owner o e-mail para definir a senha (link válido por 7 dias) e reabre o guia de primeiros passos.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" disabled={busy === "resend"} onClick={resendOwnerAccess}>
              {busy === "resend" ? "Enviando…" : "Reenviar acesso"}
            </Button>
            <Button variant="outline" disabled={busy === "reset-onboarding"} onClick={resetOnboarding}>
              {busy === "reset-onboarding" ? "…" : "Reabrir onboarding"}
            </Button>
            <Button variant="outline" disabled={busy === "seed-clauses"} onClick={seedClauses}>
              {busy === "seed-clauses" ? "…" : "Semear cláusulas padrão"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Suspensão</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {suspended ? "Tenant suspenso — acesso bloqueado." : "Tenant ativo."}
          </p>
          <Button variant={suspended ? "default" : "outline"} disabled={busy === "suspend"} onClick={toggleSuspend}>
            {suspended ? "Reativar" : "Suspender"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="text-sm text-destructive">Zona de perigo</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Excluir o tenant e todos os seus dados. Irreversível.</p>
          <Button variant="destructive" onClick={() => { setConfirmText(""); setDeleteOpen(true); }}>Excluir tenant</Button>
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {orgName}?</DialogTitle>
            <DialogDescription>
              Ação destrutiva e irreversível. Digite <span className="font-mono font-medium">{expectedConfirm}</span> para confirmar.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={expectedConfirm} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={busy === "delete" || confirmText.trim() !== expectedConfirm} onClick={doDelete}>
              {busy === "delete" ? "Excluindo…" : "Excluir definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BrandingFeesEditor({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("");
  const [poweredBy, setPoweredBy] = useState(true);
  const [platformFeePercent, setPlatformFeePercent] = useState("");

  async function save() {
    setBusy(true);
    try {
      if (primaryColor || poweredBy != null) {
        const body: Record<string, unknown> = { poweredBy };
        if (/^#[0-9a-fA-F]{6}$/.test(primaryColor)) body.primaryColor = primaryColor;
        const r1 = await fetch(`/api/admin/orgs/${orgId}/branding`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r1.ok) { toast.error("Falha no branding"); return; }
      }
      if (platformFeePercent.trim() !== "") {
        const n = Number(platformFeePercent);
        if (Number.isNaN(n)) { toast.error("Taxa inválida"); return; }
        const r2 = await fetch(`/api/admin/orgs/${orgId}/fees`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platformFeePercent: n }),
        });
        if (!r2.ok) { toast.error("Falha nas taxas"); return; }
      }
      toast.success("Branding/taxas atualizados.");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Editar branding / taxas</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Branding e taxas</DialogTitle>
            <DialogDescription>Campos em branco não são alterados.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Cor primária (hex)</label>
              <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#115E59" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={poweredBy} onChange={(e) => setPoweredBy(e.target.checked)} />
              Exibir &quot;powered by&quot;
            </label>
            <div>
              <label className="text-xs text-muted-foreground">Taxa de plataforma (%) — aplica a todas as contas</label>
              <Input value={platformFeePercent} onChange={(e) => setPlatformFeePercent(e.target.value)} placeholder="ex: 2.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
