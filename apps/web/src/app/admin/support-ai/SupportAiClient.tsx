"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Trash2, Search, MessageSquare, RefreshCw, Sprout } from "lucide-react";

const MODULE_TAGS = ["geral", "vendas", "locacao"] as const;
type ModuleTag = (typeof MODULE_TAGS)[number];

// ── Config ───────────────────────────────────────────────────────────────────
interface SupportConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  handoffMinSimilarity: number;
}

function ConfigTab({ canEdit }: { canEdit: boolean }) {
  const [cfg, setCfg] = useState<SupportConfig | null>(null);
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/support/config")
      .then((r) => r.json())
      .then((d) => {
        setCfg(d.config);
        setDefaultPrompt(d.defaults?.systemPrompt ?? "");
      })
      .catch(() => toast.error("Falha ao carregar config"));
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/support/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error();
      toast.success("Config salva");
    } catch {
      toast.error("Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (!cfg) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label className="text-xs">Modelo</Label>
          <Input
            value={cfg.model}
            disabled={!canEdit}
            onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">Temperature</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={cfg.temperature}
            disabled={!canEdit}
            onChange={(e) => setCfg({ ...cfg, temperature: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label className="text-xs">Max tokens</Label>
          <Input
            type="number"
            value={cfg.maxTokens}
            disabled={!canEdit}
            onChange={(e) => setCfg({ ...cfg, maxTokens: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label className="text-xs">Limiar de handoff</Label>
          <Input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={cfg.handoffMinSimilarity}
            disabled={!canEdit}
            onChange={(e) => setCfg({ ...cfg, handoffMinSimilarity: Number(e.target.value) })}
          />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">System prompt</Label>
          {canEdit && (
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => setCfg({ ...cfg, systemPrompt: defaultPrompt })}
            >
              Restaurar padrão
            </button>
          )}
        </div>
        <Textarea
          rows={12}
          value={cfg.systemPrompt}
          disabled={!canEdit}
          onChange={(e) => setCfg({ ...cfg, systemPrompt: e.target.value })}
          className="font-mono text-xs"
        />
      </div>
      {canEdit ? (
        <Button onClick={save} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Somente super_admin pode editar o prompt e o modelo.
        </p>
      )}
    </div>
  );
}

// ── Base de conhecimento ─────────────────────────────────────────────────────
interface KbItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: string | null;
  chunkTotal: number;
  updatedAt: string;
}

function TagPicker({
  value,
  onChange,
}: {
  value: ModuleTag[];
  onChange: (v: ModuleTag[]) => void;
}) {
  return (
    <div className="flex gap-2">
      {MODULE_TAGS.map((t) => {
        const on = value.includes(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
            }`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

function KnowledgeTab() {
  const [items, setItems] = useState<KbItem[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<ModuleTag[]>(["geral"]);
  const [creating, setCreating] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { title: string; content: string; similarity: number | null }[] | null
  >(null);
  const [mode, setMode] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/admin/support/knowledge").then((r) => r.json());
      setItems(d.items ?? []);
      setOrgId(d.orgId ?? null);
      setCount(typeof d.count === "number" ? d.count : (d.items?.length ?? 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function seedDefaults() {
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/support/knowledge/seed", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "");
      toast.success(`Base semeada: ${d.created} itens (org ${d.orgId})`);
      load();
    } catch {
      toast.error("Falha ao semear a base");
    } finally {
      setSeeding(false);
    }
  }

  async function create() {
    if (title.trim().length < 3 || content.trim().length < 3 || tags.length === 0) {
      toast.error("Preencha título, conteúdo e ao menos uma tag");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/support/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, tags }),
      });
      if (!res.ok) throw new Error();
      toast.success("Item adicionado");
      setTitle("");
      setContent("");
      setTags(["geral"]);
      load();
    } catch {
      toast.error("Falha ao adicionar (verifique VOYAGE_API_KEY)");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/admin/support/knowledge/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function testRag() {
    if (!query.trim()) return;
    const d = await fetch("/api/admin/support/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }).then((r) => r.json());
    setResults(d.results ?? []);
    setMode(d.mode ?? "");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-medium">Novo item</h3>
          <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            rows={5}
            placeholder="Conteúdo (como usar a ferramenta…)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <TagPicker value={tags} onChange={setTags} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={create} disabled={creating}>
              {creating ? "Salvando…" : "Adicionar"}
            </Button>
            <Button size="sm" variant="outline" onClick={seedDefaults} disabled={seeding}>
              <Sprout className="mr-1 h-3.5 w-3.5" />
              {seeding ? "Semeando…" : "Semear base padrão"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            &quot;Semear base padrão&quot; roda no servidor (banco/org deste ambiente) — idempotente.
          </p>
        </Card>

        <Card className="space-y-2 p-4">
          <h3 className="flex items-center gap-1 text-sm font-medium">
            <Search className="h-3.5 w-3.5" /> Testar RAG
          </h3>
          <div className="flex gap-2">
            <Input
              placeholder="Ex.: como envio um contrato para assinatura?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && testRag()}
            />
            <Button size="sm" variant="outline" onClick={testRag}>
              Buscar
            </Button>
          </div>
          {results && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Modo: {mode === "semantic" ? "semântico (Voyage)" : "palavra-chave (fallback)"} ·{" "}
                {results.length} resultado(s)
              </p>
              {results.map((r, i) => (
                <div key={i} className="rounded border p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">{r.title}</span>
                    {r.similarity != null && (
                      <Badge variant="outline" className="text-[10px]">
                        {r.similarity.toFixed(3)}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-muted-foreground">{r.content}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Itens ({items.length})</h3>
            <p className="text-[11px] text-muted-foreground">
              Base: {count} {count === 1 ? "item" : "itens"}
              {orgId && (
                <>
                  {" · org "}
                  <code className="text-[10px]">{orgId}</code>
                </>
              )}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && items.length === 0 && (
          <div className="space-y-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p>Base vazia neste ambiente.</p>
            <Button size="sm" onClick={seedDefaults} disabled={seeding}>
              <Sprout className="mr-1 h-3.5 w-3.5" />
              {seeding ? "Semeando…" : "Semear base padrão"}
            </Button>
          </div>
        )}
        {items.map((i) => (
          <Card key={i.id} className="flex items-start justify-between gap-2 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{i.title}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{i.content}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {i.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
                {i.chunkTotal > 1 && (
                  <span className="text-[10px] text-muted-foreground">
                    {i.chunkTotal} chunks
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => remove(i.id)}
              className="text-muted-foreground hover:text-red-600"
              aria-label="Excluir"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Pendências (handoffs) ─────────────────────────────────────────────────────
interface Handoff {
  id: string;
  question: string;
  screenPath: string | null;
  status: string;
  count: number;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
}

function HandoffsTab() {
  const [status, setStatus] = useState<"pending" | "answered">("pending");
  const [rows, setRows] = useState<Handoff[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { answer: string; tag: ModuleTag }>>({});

  const load = useCallback(async () => {
    const d = await fetch(`/api/admin/support/handoffs?status=${status}`).then((r) => r.json());
    setRows(d.handoffs ?? []);
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function answer(id: string) {
    const draft = drafts[id];
    if (!draft?.answer || draft.answer.trim().length < 3) {
      toast.error("Escreva a resposta");
      return;
    }
    const res = await fetch(`/api/admin/support/handoffs/${id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: draft.answer, tag: draft.tag ?? "geral" }),
    });
    if (res.ok) {
      toast.success("Respondido — base alimentada e usuário notificado");
      load();
    } else {
      toast.error("Falha ao responder");
    }
  }

  async function dismiss(id: string) {
    await fetch(`/api/admin/support/handoffs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["pending", "answered"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => setStatus(s)}
          >
            {s === "pending" ? "Pendentes" : "Respondidas"}
          </Button>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nada por aqui.</p>
      )}

      {rows.map((h) => (
        <Card key={h.id} className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{h.question}</p>
              <p className="text-[11px] text-muted-foreground">
                {h.screenPath ?? "sem tela"} · {new Date(h.createdAt).toLocaleString("pt-BR")}
                {h.count > 1 && ` · ${h.count}× perguntado`}
              </p>
            </div>
            {h.count > 1 && <Badge variant="destructive">{h.count}×</Badge>}
          </div>

          {status === "pending" ? (
            <>
              <Textarea
                rows={3}
                placeholder="Resposta (vira item da base e é enviada ao usuário)…"
                value={drafts[h.id]?.answer ?? ""}
                onChange={(e) =>
                  setDrafts((p) => ({
                    ...p,
                    [h.id]: { answer: e.target.value, tag: p[h.id]?.tag ?? "geral" },
                  }))
                }
              />
              <div className="flex items-center justify-between">
                <TagPicker
                  value={[drafts[h.id]?.tag ?? "geral"]}
                  onChange={(v) =>
                    setDrafts((p) => ({
                      ...p,
                      [h.id]: { answer: p[h.id]?.answer ?? "", tag: v[v.length - 1] ?? "geral" },
                    }))
                  }
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => dismiss(h.id)}>
                    Descartar
                  </Button>
                  <Button size="sm" onClick={() => answer(h.id)}>
                    Responder
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded bg-muted p-2 text-xs">
              <p className="whitespace-pre-wrap">{h.answer}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Respondido em {h.answeredAt ? new Date(h.answeredAt).toLocaleString("pt-BR") : "—"}
              </p>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Insights ──────────────────────────────────────────────────────────────────
interface Insights {
  windowDays: number;
  kpis: {
    total: number;
    handoffs: number;
    up: number;
    down: number;
    lowConfidence: number;
    handoffRate: number;
  };
  pendingCount: number;
  topPending: { id: string; question: string; count: number; screenPath: string | null }[];
  /** Era a única métrica do admin sem linha por org — o blob global dizia
   *  "há 12 handoffs" sem dizer de quem. */
  perTenant: { orgId: string; name: string; total: number; negatives: number; handoffs: number }[];
  recentNegative: { id: string; question: string; screenPath: string | null; createdAt: string }[];
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

function InsightsTab() {
  const [data, setData] = useState<Insights | null>(null);

  useEffect(() => {
    fetch("/api/admin/support/insights")
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error("Falha ao carregar insights"));
  }, []);

  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const k = data.kpis;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={`Interações (${data.windowDays}d)`} value={k.total} />
        <Kpi label="Handoffs" value={k.handoffs} />
        <Kpi label="Taxa handoff" value={`${k.handoffRate}%`} />
        <Kpi label="👍" value={k.up} />
        <Kpi label="👎" value={k.down} />
        <Kpi label="Baixa confiança" value={k.lowConfidence} />
      </div>

      {(data.perTenant?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Por tenant ({data.windowDays}d)</h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Tenant</th>
                  <th className="p-2 font-medium">Interações</th>
                  <th className="p-2 font-medium">👎</th>
                  <th className="p-2 font-medium">Handoffs</th>
                </tr>
              </thead>
              <tbody>
                {data.perTenant.map((t) => (
                  <tr key={t.orgId} className="border-t">
                    <td className="p-2 font-medium">{t.name}</td>
                    <td className="p-2 tabular-nums">{t.total}</td>
                    <td className="p-2 tabular-nums">
                      {t.negatives > 0 ? (
                        <span className="text-destructive">{t.negatives}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="p-2 tabular-nums">{t.handoffs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium">
            Perguntas sem resposta ({data.pendingCount} pendentes)
          </h3>
          {data.topPending.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma pendência.</p>
          )}
          <div className="space-y-1">
            {data.topPending.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded border p-2 text-xs">
                <span className="min-w-0 truncate">{p.question}</span>
                <Badge variant="secondary">{p.count}×</Badge>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-1 text-sm font-medium">
            <MessageSquare className="h-3.5 w-3.5" /> Respostas com 👎 recentes
          </h3>
          {data.recentNegative.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma.</p>
          )}
          <div className="space-y-1">
            {data.recentNegative.map((n) => (
              <div key={n.id} className="rounded border p-2 text-xs">
                <p className="truncate">{n.question}</p>
                <p className="text-[10px] text-muted-foreground">
                  {n.screenPath ?? "—"} · {new Date(n.createdAt).toLocaleDateString("pt-BR")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
export function SupportAiClient({ canEditConfig }: { canEditConfig: boolean }) {
  return (
    <Tabs defaultValue="handoffs">
      <TabsList>
        <TabsTrigger value="config">Prompt &amp; config</TabsTrigger>
        <TabsTrigger value="kb">Base de conhecimento</TabsTrigger>
        <TabsTrigger value="handoffs">Pendências</TabsTrigger>
        <TabsTrigger value="insights">Insights</TabsTrigger>
      </TabsList>
      <TabsContent value="config" className="mt-4">
        <ConfigTab canEdit={canEditConfig} />
      </TabsContent>
      <TabsContent value="kb" className="mt-4">
        <KnowledgeTab />
      </TabsContent>
      <TabsContent value="handoffs" className="mt-4">
        <HandoffsTab />
      </TabsContent>
      <TabsContent value="insights" className="mt-4">
        <InsightsTab />
      </TabsContent>
    </Tabs>
  );
}
