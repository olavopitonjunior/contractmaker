"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RagScopeEditor, type RagScope } from "@/components/settings/RagScopeEditor";

/** Espelha RAG_SCOPE_CATEGORIES do servidor. */
const RAG_CATEGORIES = ["legislation", "model", "rule", "glossary", "clause"] as const;
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** "herda do nível de cima" — o Select não aceita value="" */
const INHERIT = "__inherit";

const MODEL_LABELS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-opus-4-6": "Opus 4.6",
};

interface AgentRow {
  agentKey: string;
  label: string;
  description: string;
  external: boolean;
  tenantEditable: boolean;
  supports: { enabled: boolean; model: boolean; instructions: boolean };
  defaultModel: string;
  own: {
    enabled: boolean;
    model: string | null;
    fallbackModel: string | null;
    temperature: number | null;
    maxTokens: number | null;
    instructions: string;
    ragScope: RagScope | null;
    monthlyBudgetUsd: number | null;
  };
  resolved: {
    model: string;
    fallbackModel: string | null;
    enabled: boolean;
    ragScope: RagScope | null;
  };
}

interface OrgOption {
  id: string;
  name: string;
}

export function AgentsConsoleClient({
  canEdit,
  orgs,
}: {
  canEdit: boolean;
  orgs: OrgOption[];
}) {
  const [scopeOrgId, setScopeOrgId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [allowedModels, setAllowedModels] = useState<string[]>([]);

  const load = useCallback(async (orgId: string) => {
    setLoading(true);
    try {
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      const res = await fetch(`/api/admin/agents${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao carregar");
      setAgents(data.agents ?? []);
      setAllowedModels(data.allowedModels ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scopeOrgId);
  }, [scopeOrgId, load]);

  function patchLocal(agentKey: string, patch: Partial<AgentRow["own"]>) {
    setAgents((rows) =>
      rows.map((r) =>
        r.agentKey === agentKey ? { ...r, own: { ...r.own, ...patch } } : r
      )
    );
  }

  async function save(row: AgentRow) {
    setSavingKey(row.agentKey);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: scopeOrgId || null,
          agentKey: row.agentKey,
          enabled: row.own.enabled,
          model: row.own.model,
          fallbackModel: row.own.fallbackModel,
          temperature: row.own.temperature,
          maxTokens: row.own.maxTokens,
          instructions: row.own.instructions,
          ragScope: row.own.ragScope,
          monthlyBudgetUsd: row.own.monthlyBudgetUsd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar");
      toast.success("Salvo — pega em ≤1 min nos turns em andamento.");
      await load(scopeOrgId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSavingKey(null);
    }
  }

  const isPlatform = !scopeOrgId;

  return (
    <div className="space-y-6">
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
              <SelectItem value="__platform">
                Plataforma (padrão de todos os tenants)
              </SelectItem>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {isPlatform
            ? "Editando o padrão da plataforma. Campo vazio = usa o hardcoded do código."
            : "Editando o override deste tenant. Campo vazio = herda da plataforma."}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        agents.map((row) => (
          <Card key={row.agentKey}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm">{row.label}</CardTitle>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {row.agentKey}
                </Badge>
                {row.external && <Badge variant="secondary">externo</Badge>}
                {!row.resolved.enabled && (
                  <Badge variant="destructive">desativado</Badge>
                )}
                {!row.supports.enabled &&
                  !row.supports.model &&
                  !row.supports.instructions && (
                    <Badge variant="outline">config ainda não aplicada</Badge>
                  )}
              </div>
              <p className="text-xs text-muted-foreground">{row.description}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label className="mb-1 block text-xs">Modelo</Label>
                  <Select
                    value={row.own.model ?? INHERIT}
                    onValueChange={(v) =>
                      patchLocal(row.agentKey, { model: v === INHERIT ? null : v })
                    }
                    disabled={!canEdit || !row.supports.model}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={INHERIT}>
                        {isPlatform
                          ? `Padrão do código — ${MODEL_LABELS[row.defaultModel] ?? row.defaultModel}`
                          : `Herda da plataforma — ${MODEL_LABELS[row.resolved.model] ?? row.resolved.model}`}
                      </SelectItem>
                      {allowedModels.map((m) => (
                        <SelectItem key={m} value={m}>
                          {MODEL_LABELS[m] ?? m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-1 block text-xs">
                    Fallback (429/529)
                  </Label>
                  <Select
                    value={row.own.fallbackModel ?? INHERIT}
                    onValueChange={(v) =>
                      patchLocal(row.agentKey, {
                        fallbackModel: v === INHERIT ? null : v,
                      })
                    }
                    disabled={!canEdit || !row.supports.model}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={INHERIT}>Sem fallback</SelectItem>
                      {allowedModels.map((m) => (
                        <SelectItem key={m} value={m}>
                          {MODEL_LABELS[m] ?? m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-1 block text-xs">
                    Teto mensal (USD)
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={row.own.monthlyBudgetUsd ?? ""}
                    placeholder={isPlatform ? "sem teto" : "sem teto"}
                    onChange={(e) =>
                      patchLocal(row.agentKey, {
                        monthlyBudgetUsd:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    disabled={!canEdit}
                  />
                </div>

                <div className="flex items-end gap-2 pb-2">
                  <Switch
                    id={`enabled-${row.agentKey}`}
                    checked={row.own.enabled}
                    onCheckedChange={(v) =>
                      patchLocal(row.agentKey, { enabled: v })
                    }
                    disabled={!canEdit || !row.supports.enabled}
                  />
                  <Label
                    htmlFor={`enabled-${row.agentKey}`}
                    className="text-xs"
                  >
                    Ativo
                  </Label>
                </div>
              </div>

              <div>
                <Label className="mb-1 block text-xs">
                  Instruções adicionais
                </Label>
                <Textarea
                  value={row.own.instructions}
                  onChange={(e) =>
                    patchLocal(row.agentKey, { instructions: e.target.value })
                  }
                  disabled={!canEdit || !row.supports.instructions}
                  rows={5}
                  placeholder={
                    row.supports.instructions
                      ? "Apendadas ao prompt-base do agente (que já se adapta a venda × locação). Vazio = sem override."
                      : "Este agente ainda não lê instruções do console."
                  }
                  className="font-mono text-xs"
                />
              </div>

              <div className="border-t pt-3">
                <Label className="mb-2 block text-xs">
                  Base de conhecimento que este agente consulta
                </Label>
                <RagScopeEditor
                  value={row.own.ragScope}
                  categories={RAG_CATEGORIES}
                  disabled={!canEdit}
                  onChange={(next) => patchLocal(row.agentKey, { ragScope: next })}
                />
                {/* Herança tem que ser visível: com o escopo vazio neste nível, o
                    que vale é o de cima, e sem esta linha o admin lê "sem
                    restrição" onde na verdade há uma. */}
                {!row.own.ragScope && row.resolved.ragScope && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Sem escopo próprio — herdando o da plataforma:{" "}
                    <code className="font-mono">
                      {JSON.stringify(row.resolved.ragScope)}
                    </code>
                  </p>
                )}
              </div>

              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => save(row)}
                  disabled={savingKey === row.agentKey}
                >
                  {savingKey === row.agentKey ? "Salvando…" : "Salvar"}
                </Button>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
