"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";
import { useSettingsAutoSave } from "@/hooks/use-settings-auto-save";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Kind = "venda" | "locacao";

interface PolicyRow {
  stageId: string;
  stageName: string;
  position: number;
  terminal: boolean;
  warnDays: number | null;
  dangerDays: number | null;
  enabled: boolean;
  source: "custom" | "default";
}

/** Estado editável por stage (string pra input controlado). */
interface DraftRow {
  warnDays: string;
  dangerDays: string;
  enabled: boolean;
}

const DEFAULT_WARN = 5;
const DEFAULT_DANGER = 10;

function toDraft(p: PolicyRow): DraftRow {
  return {
    warnDays: String(p.warnDays ?? DEFAULT_WARN),
    dangerDays: String(p.dangerDays ?? DEFAULT_DANGER),
    enabled: p.enabled,
  };
}

/**
 * Faixa que o servidor aceita para todo prazo (`min(1).max(365)` + o refine
 * `dangerDays >= warnDays` em `api/org/sla-policies`).
 *
 * Vale para TODA linha enviada, inclusive as com o SLA desligado — o Zod não
 * abre exceção para elas. O botão antigo só validava as ligadas e mandava o
 * lote inteiro, então apagar um prazo e desligar a etapa em seguida fazia o
 * PATCH voltar 400 e derrubava junto as etapas que estavam corretas.
 */
function linhaValida(d: DraftRow): boolean {
  const warn = Number(d.warnDays);
  const danger = Number(d.dangerDays);
  return (
    Number.isInteger(warn) &&
    Number.isInteger(danger) &&
    warn >= 1 &&
    danger >= 1 &&
    warn <= 365 &&
    danger <= 365 &&
    danger >= warn
  );
}

export default function SlaSettingsClient() {
  const [kind, setKind] = useState<Kind>("venda");
  const [rows, setRows] = useState<PolicyRow[] | null>(null);

  const load = useCallback(async (k: Kind) => {
    setRows(null);
    try {
      const res = await fetch(`/api/org/sla-policies?kind=${k}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { policies: PolicyRow[] };
      setRows(data.policies);
    } catch {
      toast.error("Falha ao carregar as políticas de SLA");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load(kind);
  }, [kind, load]);

  return (
    <div className="space-y-4">
      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList>
          <TabsTrigger value="venda">Vendas</TabsTrigger>
          <TabsTrigger value="locacao">Locação</TabsTrigger>
        </TabsList>
      </Tabs>

      {rows === null ? (
        <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6">
          Pipeline de {kind === "venda" ? "vendas" : "locação"} não configurado
          pra esta organização.
        </p>
      ) : (
        // `key={kind}` remonta o editor ao trocar de esteira: cada aba tem a
        // própria baseline de auto-save, e o que estava em vias de ser salvo é
        // gravado no unmount em vez de sumir (ver `use-settings-auto-save`).
        <SlaKindEditor
          key={kind}
          kind={kind}
          initialRows={rows}
          onRowsChange={setRows}
        />
      )}
    </div>
  );
}

function SlaKindEditor({
  kind,
  initialRows,
  onRowsChange,
}: {
  kind: Kind;
  initialRows: PolicyRow[];
  onRowsChange: (rows: PolicyRow[]) => void;
}) {
  const [rows, setRows] = useState<PolicyRow[]>(initialRows);
  const [draft, setDraft] = useState<Record<string, DraftRow>>(() =>
    Object.fromEntries(
      initialRows.filter((p) => !p.terminal).map((p) => [p.stageId, toDraft(p)]),
    ),
  );
  const [saving, setSaving] = useState(false);

  const editable = rows.filter((p) => !p.terminal);
  const terminals = rows.filter((p) => p.terminal);

  // Só as etapas que mudaram viajam. O upsert da rota é por `stageId`, então
  // etapa ausente do corpo fica intacta — e uma linha inválida deixa de
  // arrastar as outras para o 400.
  const sujas = editable.filter((p) => {
    const d = draft[p.stageId];
    if (!d) return false;
    const base = toDraft(p);
    return (
      d.warnDays !== base.warnDays ||
      d.dangerDays !== base.dangerDays ||
      d.enabled !== base.enabled
    );
  });

  // Sem `useMemo`: o hook já compara por serialização, então memoizar aqui só
  // acrescentaria uma dependência auto-referente (a chave sairia do próprio
  // `sujas`) que quebraria em silêncio se alguém memoizasse `rows`/`draft`.
  const policies = sujas.map((p) => {
    const d = draft[p.stageId]!;
    return {
      stageId: p.stageId,
      warnDays: Number(d.warnDays),
      dangerDays: Number(d.dangerDays),
      enabled: d.enabled,
    };
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/org/sla-policies?kind=${kind}`);
      if (!res.ok) return;
      const data = (await res.json()) as { policies: PolicyRow[] };
      setRows(data.policies);
      onRowsChange(data.policies);
    } catch {
      /* a tela segue com o que tem; o próximo save reconcilia */
    }
  }, [kind, onRowsChange]);

  const autoSave = useSettingsAutoSave(
    { policies },
    {
      endpoint: "/api/org/sla-policies",
      // `kind` é constante nesta instância (o pai remonta por `key={kind}`),
      // então nunca ficaria "sujo" e nunca entraria no diff — mas o schema da
      // rota é `.strict()` e o exige. Sem `alwaysInclude`, todo save voltaria
      // 400 "Body inválido".
      alwaysInclude: { kind },
      isValid: () => sujas.every((p) => linhaValida(draft[p.stageId]!)),
      onSaved: () => {
        // A rota devolve o lote recalculado; sem re-sincronizar, o selo
        // "Personalizado" e o botão de restaurar ficariam desatualizados.
        void refresh();
      },
    },
  );

  const invalido = sujas.some((p) => !linhaValida(draft[p.stageId]!));

  async function restoreDefault(stageId?: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/org/sla-policies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...(stageId ? { stageId } : {}) }),
      });
      if (res.status === 403) {
        toast.error("Sem permissão pra editar configurações da organização");
        return;
      }
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { policies: PolicyRow[] };
      setRows(data.policies);
      onRowsChange(data.policies);
      setDraft(
        Object.fromEntries(
          data.policies.filter((p) => !p.terminal).map((p) => [p.stageId, toDraft(p)])
        )
      );
      toast.success(
        stageId ? "Etapa restaurada pro padrão (5/10)" : "Todas as etapas no padrão (5/10)"
      );
    } catch {
      toast.error("Falha ao restaurar o padrão");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        {invalido && (
          <p className="text-xs text-destructive">
            Revise os prazos: atenção ≥ 1 dia, atrasado ≥ atenção, até 365 —
            ainda não foi salvo.
          </p>
        )}
        <SaveStatusPill status={autoSave.status} isDirty={autoSave.isDirty} />
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
            {editable.map((p) => {
              const d = draft[p.stageId] ?? toDraft(p);
              return (
                <div
                  key={p.stageId}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{p.stageName}</span>
                      {p.source === "custom" ? (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          Personalizado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          Padrão
                        </Badge>
                      )}
                    </div>
                    {!d.enabled && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        SLA desligado — negócios nesta etapa não envelhecem.
                      </p>
                    )}
                  </div>

                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Atenção
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={d.warnDays}
                      disabled={!d.enabled}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [p.stageId]: { ...d, warnDays: e.target.value },
                        }))
                      }
                      className="h-8 w-16 text-right tabular-nums"
                    />
                    d
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Atrasado
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={d.dangerDays}
                      disabled={!d.enabled}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [p.stageId]: { ...d, dangerDays: e.target.value },
                        }))
                      }
                      className="h-8 w-16 text-right tabular-nums"
                    />
                    d
                  </label>
                  <Switch
                    checked={d.enabled}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({
                        ...prev,
                        [p.stageId]: { ...d, enabled: checked },
                      }))
                    }
                    aria-label={`SLA ativo em ${p.stageName}`}
                  />
                  {p.source === "custom" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-muted-foreground"
                      disabled={saving}
                      onClick={() => restoreDefault(p.stageId)}
                      title="Restaurar padrão (5/10)"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}

            {terminals.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[11px] text-muted-foreground">
                  Etapas terminais sem SLA:{" "}
                  {terminals.map((t) => t.stageName).join(" · ")}
                </p>
              </div>
            )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          disabled={saving || !rows.some((p) => p.source === "custom")}
          onClick={() => restoreDefault()}
        >
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Restaurar tudo pro padrão
        </Button>
        <p className="text-[11px] text-muted-foreground">
          As alterações valem sozinhas e recalculam os prazos dos negócios
          ativos em segundo plano.
        </p>
      </div>
    </div>
  );
}
