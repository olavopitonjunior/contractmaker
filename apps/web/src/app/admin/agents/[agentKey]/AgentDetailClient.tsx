"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentsConsoleClient } from "../AgentsConsoleClient";
import { RowsCard } from "@/app/admin/metrics/AiMetricsClient";
import {
  KpiCard,
  RangePicker,
  rangeToQuery,
  formatUsd,
  formatInt,
  type RangePreset,
} from "@/components/admin/charts";

export interface ToolRow {
  name: string;
  write: boolean;
  description: string | null;
}

interface OrgOption {
  id: string;
  name: string;
}

interface PromptResponse {
  composition: "append" | "replace" | "none" | "external";
  note: string | null;
  platformInstructions: string | null;
  tenantInstructions: string | null;
  variants: Array<{ label: string | null; base: string; composed: string }>;
}

const COMPOSITION_LABELS: Record<PromptResponse["composition"], string> = {
  append: "Instruções do console são APENDADAS a este prompt-base.",
  replace:
    "EXCEÇÃO documentada: aqui as instruções do console SUBSTITUEM o prompt-base inteiro.",
  none: "Prompt fixo — instruções do console não entram.",
  external: "Runtime externo — o prompt não mora neste repositório.",
};

export function AgentDetailClient({
  agentKey,
  canEdit,
  showPrompt,
  orgs,
  tools,
  toolsNote,
}: {
  agentKey: string;
  canEdit: boolean;
  showPrompt: boolean;
  orgs: OrgOption[];
  tools: ToolRow[];
  toolsNote: string | null;
}) {
  const consulta = tools.filter((t) => !t.write);
  const ativacao = tools.filter((t) => t.write);

  return (
    <Tabs defaultValue="config">
      <TabsList>
        <TabsTrigger value="config">Config</TabsTrigger>
        {showPrompt && <TabsTrigger value="prompt">Prompt</TabsTrigger>}
        <TabsTrigger value="tools">Tools</TabsTrigger>
        <TabsTrigger value="custo">Custo</TabsTrigger>
        {/* Snapshot carrega instructions — mesmo gate da aba Prompt. */}
        {showPrompt && <TabsTrigger value="historico">Histórico</TabsTrigger>}
      </TabsList>

      <TabsContent value="config" className="pt-4">
        <AgentsConsoleClient canEdit={canEdit} orgs={orgs} onlyAgentKey={agentKey} />
      </TabsContent>

      {showPrompt && (
        <TabsContent value="prompt" className="pt-4">
          <PromptTab agentKey={agentKey} orgs={orgs} />
        </TabsContent>
      )}

      <TabsContent value="tools" className="space-y-4 pt-4">
        {toolsNote && <p className="text-xs text-muted-foreground">{toolsNote}</p>}
        {tools.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ToolsCard
              title={`Consulta (${consulta.length})`}
              hint="Leem sem alterar o contrato."
              tools={consulta}
            />
            <ToolsCard
              title={`Ativação (${ativacao.length})`}
              hint="Escrevem no documento — são estas que o modo Planejar poda do toolbox."
              tools={ativacao}
            />
          </div>
        )}
      </TabsContent>

      <TabsContent value="custo" className="pt-4">
        <CostTab agentKey={agentKey} />
      </TabsContent>

      {showPrompt && (
        <TabsContent value="historico" className="pt-4">
          <HistoryTab agentKey={agentKey} canEdit={canEdit} orgs={orgs} />
        </TabsContent>
      )}
    </Tabs>
  );
}

// ── Histórico ────────────────────────────────────────────────────────────────

type Snapshot = Record<string, unknown>;

interface Version {
  id: string;
  snapshot: Snapshot;
  updatedByName: string | null;
  createdAt: string;
}

/** Campos que mudaram entre dois snapshots — o diff que a tela mostra. */
function diffSnapshots(atual: Snapshot, anterior: Snapshot | null): string[] {
  const keys = new Set([
    ...Object.keys(atual),
    ...Object.keys(anterior ?? {}),
  ]);
  const changed: string[] = [];
  for (const k of keys) {
    const a = JSON.stringify(atual[k] ?? null);
    const b = JSON.stringify(anterior?.[k] ?? null);
    if (a !== b) changed.push(k);
  }
  return changed;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  return JSON.stringify(v);
}

function HistoryTab({
  agentKey,
  canEdit,
  orgs,
}: {
  agentKey: string;
  canEdit: boolean;
  orgs: OrgOption[];
}) {
  const [scopeOrgId, setScopeOrgId] = useState<string>("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async (orgId: string) => {
    setError(null);
    try {
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      const res = await fetch(`/api/admin/agents/${agentKey}/versions${qs}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Falha ao carregar");
      setVersions(d.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [agentKey]);

  useEffect(() => {
    void load(scopeOrgId);
  }, [scopeOrgId, load]);

  async function restore(versionId: string) {
    setRestoring(versionId);
    try {
      const res = await fetch(
        `/api/admin/agents/${agentKey}/versions/${versionId}/restore`,
        { method: "POST" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Falha ao restaurar");
      await load(scopeOrgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao restaurar");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Label className="mb-1 block text-xs">Escopo</Label>
          <Select
            value={scopeOrgId || "__platform"}
            onValueChange={(v) => setScopeOrgId(v === "__platform" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__platform">Plataforma</SelectItem>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Um snapshot por salvo. Restaurar cria uma versão NOVA com o estado
          antigo — nada é apagado, e o efeito pega em ≤1 min.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {versions && versions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma escrita neste escopo ainda — o histórico começa no próximo
          salvo.
        </p>
      )}

      <div className="space-y-3">
        {versions?.map((v, i) => {
          const anterior = versions[i + 1]?.snapshot ?? null;
          const mudou = diffSnapshots(v.snapshot, anterior);
          return (
            <Card key={v.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm">
                    {new Date(v.createdAt).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    {v.updatedByName && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        por {v.updatedByName}
                      </span>
                    )}
                    {i === 0 && <Badge className="ml-2">atual</Badge>}
                  </CardTitle>
                  {canEdit && i > 0 && (
                    <button
                      className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      disabled={restoring === v.id}
                      onClick={() => restore(v.id)}
                    >
                      {restoring === v.id ? "Restaurando…" : "Restaurar esta versão"}
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                {mudou.length === 0 && (
                  <p className="text-muted-foreground">
                    Sem mudança em relação à anterior (salvo idêntico).
                  </p>
                )}
                {mudou.map((k) => (
                  <div key={k}>
                    <code className="font-mono">{k}</code>:{" "}
                    {anterior && (
                      <span className="text-muted-foreground line-through">
                        {fmt(anterior[k])}
                      </span>
                    )}{" "}
                    → <span>{fmt(v.snapshot[k])}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ToolsCard({
  title,
  hint,
  tools,
}: {
  title: string;
  hint: string;
  tools: ToolRow[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {tools.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhuma.</p>
        )}
        {tools.map((t) => (
          <div key={t.name} className="text-xs">
            <code className="font-mono">{t.name}</code>
            {t.description && (
              <p className="text-muted-foreground">{t.description}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PromptTab({ agentKey, orgs }: { agentKey: string; orgs: OrgOption[] }) {
  const [scopeOrgId, setScopeOrgId] = useState<string>("");
  const [data, setData] = useState<PromptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (orgId: string) => {
    setError(null);
    try {
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      const res = await fetch(`/api/admin/agents/${agentKey}/prompt${qs}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Falha ao carregar");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [agentKey]);

  useEffect(() => {
    void load(scopeOrgId);
  }, [scopeOrgId, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Label className="mb-1 block text-xs">Escopo (instruções compostas)</Label>
          <Select
            value={scopeOrgId || "__platform"}
            onValueChange={(v) => setScopeOrgId(v === "__platform" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__platform">Plataforma</SelectItem>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Leitura — o prompt-base mora no código (git). A edição continua sendo
          o apêndice, na aba Config.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            {COMPOSITION_LABELS[data.composition]}
            {data.note ? ` ${data.note}` : ""}
          </p>
          {data.variants.map((v) => (
            <Card key={v.label ?? "_"}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  Texto que vai pro modelo
                  {v.label && <Badge variant="outline">{v.label}</Badge>}
                  {v.composed !== v.base && (
                    <Badge variant="secondary">com instruções compostas</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
                  {v.composed}
                </pre>
              </CardContent>
            </Card>
          ))}
          {data.variants.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sem prompt neste repositório.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CostTab({ agentKey }: { agentKey: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [data, setData] = useState<{
    totals: { costUsd: number; calls: number; totalTokens: number };
    byModel: Array<{ key: string; label: string; costUsd: number; calls: number; totalTokens: number }>;
    byOperation: Array<{ key: string; label: string; costUsd: number; calls: number; totalTokens: number }>;
    byOrg: Array<{ key: string; label: string; costUsd: number; calls: number; totalTokens: number }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/metrics/ai?${rangeToQuery(preset)}&agentKey=${agentKey}`
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Falha ao carregar");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [preset, agentKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Custo deste agente no período</p>
        <RangePicker value={preset} onChange={setPreset} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label="Custo" value={formatUsd(data.totals.costUsd)} />
            <KpiCard label="Chamadas" value={formatInt(data.totals.calls)} />
            <KpiCard label="Tokens" value={formatInt(data.totals.totalTokens)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <RowsCard title="Por modelo" rows={data.byModel} />
            <RowsCard title="Por operação" rows={data.byOperation} />
            <RowsCard title="Por tenant" rows={data.byOrg} />
          </div>
        </>
      )}
    </div>
  );
}
