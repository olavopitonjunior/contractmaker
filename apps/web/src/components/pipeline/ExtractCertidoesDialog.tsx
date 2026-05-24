"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Wallet,
  Plus,
  X,
} from "lucide-react";
import { ExtraCertidaoPicker, type CatalogMeta } from "./ExtraCertidaoPicker";
import type { EndpointInfo } from "@/lib/certidoes/endpoints";

interface PlannedJob {
  endpoint: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  costCents: number;
}

interface SkippedJob {
  endpoint: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  reason: string;
  missingField: string;
}

interface ExtractionPlan {
  jobs: PlannedJob[];
  skipped: SkippedJob[];
  totalCostCents: number;
}

interface Spend {
  spentCents: number;
  budgetCents: number;
  exceeded: boolean;
}

export interface JobSelection {
  endpoint: string;
  targetKind:
    | "vendedor"
    | "comprador"
    | "imovel"
    | "diligenciado"
    | "conjuge_vendedor"
    | "procurador_vendedor"
    | "representante_vendedor";
  targetIndex: number;
}

// Vendedor + seus dependentes entram MARCADOS por padrão (sempre necessários).
// Comprador e imóvel: imóvel marcado, comprador desmarcado (decisão do usuário).
const DEFAULT_SELECTED_KINDS = new Set([
  "vendedor",
  "imovel",
  "conjuge_vendedor",
  "procurador_vendedor",
  "representante_vendedor",
]);

interface ExtractCertidoesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /**
   * E2 — cor da régua do job vivo por chave (endpoint|kind|index): green=já
   * emitida, yellow=em andamento, red=falhou. Permite marcar o que já foi
   * puxado e oferecer "selecionar só as que faltaram".
   */
  extractedStatus?: Record<string, "green" | "yellow" | "red" | "neutral">;
  onConfirm: (jobs?: JobSelection[]) => Promise<void> | void;
}

interface DiligentedRow {
  id: string;
  nome: string;
  tipoPessoa: string;
}

function jobKey(j: { endpoint: string; targetKind: string; targetIndex: number }) {
  return `${j.endpoint}|${j.targetKind}|${j.targetIndex}`;
}

function groupLabel(kind: string, index: number, labelMap: Record<string, string>): string {
  const key = `${kind}-${index}`;
  if (labelMap[key]) return labelMap[key];
  const kindLabel =
    kind === "vendedor"
      ? "Vendedor"
      : kind === "comprador"
      ? "Comprador"
      : kind === "imovel"
      ? "Imóvel"
      : kind === "diligenciado"
      ? "Diligenciado"
      : kind === "conjuge_vendedor"
      ? "Cônjuge do Vendedor"
      : kind === "procurador_vendedor"
      ? "Procurador do Vendedor"
      : kind === "representante_vendedor"
      ? "Representante do Vendedor"
      : kind;
  return `${kindLabel} ${index + 1}`;
}

export function ExtractCertidoesDialog({
  open,
  onOpenChange,
  dealId,
  extractedStatus = {},
  onConfirm,
}: ExtractCertidoesDialogProps) {
  const [plan, setPlan] = useState<ExtractionPlan | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<ExtractionPlan | null>(null);
  const [catalog, setCatalog] = useState<EndpointInfo[]>([]);
  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta>({
    ufs: [],
    categories: [],
  });
  const [diligenciados, setDiligenciados] = useState<DiligentedRow[]>([]);
  const [spend, setSpend] = useState<Spend | null>(null);
  // E3 — saúde da API por endpoint (do plano): ok | degraded | down.
  const [apiHealth, setApiHealth] = useState<
    Record<string, "ok" | "degraded" | "down">
  >({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Selection state: user can check/uncheck each job in the plan + the extras
  // added via the picker. Key = `${endpoint}|${kind}|${index}`.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<PlannedJob[]>([]);
  // Picker state: which target group is the user currently adding extras for
  const [pickerFor, setPickerFor] = useState<{
    kind: string;
    index: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/deals/${dealId}/certidoes/plan?full=1`)
      .then((r) => r.json())
      .then((data) => {
        setPlan(data.plan);
        setExpandedPlan(data.expandedPlan ?? data.plan);
        setSpend(data.spend);
        setCatalog(data.catalog ?? []);
        setCatalogMeta(
          data.catalogMeta ?? { ufs: [], categories: [] }
        );
        setApiHealth(data.apiHealth ?? {});
        setDiligenciados(data.diligenciados ?? []);
        // Default: marca vendedores + seus dependentes (cônjuge/procurador/
        // representante) + imóvel. Compradores começam desmarcados — o usuário
        // marca se quiser. Decisão do usuário 2026-05-22.
        const initial = new Set<string>(
          (data.plan?.jobs ?? [])
            .filter((j: PlannedJob) => DEFAULT_SELECTED_KINDS.has(j.targetKind))
            .map((j: PlannedJob) => jobKey(j))
        );
        setSelected(initial);
        setExtras([]);
      })
      .finally(() => setLoading(false));
  }, [open, dealId]);

  // Build a map from target key to human label (uses diligenciados nomes)
  const targetLabels = useMemo(() => {
    const map: Record<string, string> = {};
    diligenciados.forEach((d, i) => {
      map[`diligenciado-${i}`] = `Diligenciado: ${d.nome}`;
    });
    // For vendedores/compradores/imoveis, extract names from the plan's jobs
    if (plan) {
      for (const j of plan.jobs) {
        const key = `${j.targetKind}-${j.targetIndex}`;
        if (!map[key] && j.targetKind !== "diligenciado") {
          // Extract the name from the job label (e.g. "CNDT - John Doe")
          const match = j.label.match(/.*? - (.+)$/);
          if (match) {
            const kindLabel =
              j.targetKind === "vendedor"
                ? "Vendedor"
                : j.targetKind === "comprador"
                ? "Comprador"
                : j.targetKind === "imovel"
                ? "Imóvel"
                : j.targetKind;
            map[key] = `${kindLabel} ${j.targetIndex + 1}: ${match[1].split(" (")[0]}`;
          }
        }
      }
    }
    return map;
  }, [plan, diligenciados]);

  // Group all jobs (auto-plan + extras) by target
  const grouped = useMemo(() => {
    if (!plan) return [];
    const groups = new Map<
      string,
      {
        kind: string;
        index: number;
        label: string;
        jobs: PlannedJob[];
      }
    >();
    const addJob = (j: PlannedJob) => {
      const key = `${j.targetKind}-${j.targetIndex}`;
      if (!groups.has(key)) {
        groups.set(key, {
          kind: j.targetKind,
          index: j.targetIndex,
          label: groupLabel(j.targetKind, j.targetIndex, targetLabels),
          jobs: [],
        });
      }
      groups.get(key)!.jobs.push(j);
    };
    plan.jobs.forEach(addJob);
    extras.forEach(addJob);
    return Array.from(groups.values());
  }, [plan, extras, targetLabels]);

  const toggleJob = (j: PlannedJob) => {
    const key = jobKey(j);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (!plan) return;
    const all = new Set<string>();
    plan.jobs.forEach((j) => all.add(jobKey(j)));
    extras.forEach((j) => all.add(jobKey(j)));
    setSelected(all);
  };

  const clearAll = () => setSelected(new Set());

  // E2 — marca só as que ainda não saíram (não emitidas nem em andamento):
  // ignora as que já estão green/yellow no estado vivo.
  const selectMissing = () => {
    const next = new Set<string>();
    const consider = (j: PlannedJob) => {
      const t = extractedStatus[jobKey(j)];
      if (t !== "green" && t !== "yellow") next.add(jobKey(j));
    };
    plan?.jobs.forEach(consider);
    extras.forEach(consider);
    setSelected(next);
  };
  const hasExtracted = Object.keys(extractedStatus).length > 0;

  const handleAddExtras = (endpointIds: string[]) => {
    if (!pickerFor || !expandedPlan) return;
    const newExtras: PlannedJob[] = [];
    for (const ep of endpointIds) {
      // Look up the full job in the expanded plan
      const match = expandedPlan.jobs.find(
        (j) =>
          j.endpoint === ep &&
          j.targetKind === pickerFor.kind &&
          j.targetIndex === pickerFor.index
      );
      if (match) {
        newExtras.push(match);
        setSelected((prev) => {
          const next = new Set(prev);
          next.add(jobKey(match));
          return next;
        });
      }
    }
    setExtras((prev) => [...prev, ...newExtras]);
    setPickerFor(null);
  };

  const openPickerFor = (kind: string, index: number, label: string) => {
    setPickerFor({ kind, index, label });
  };

  const removeExtra = (j: PlannedJob) => {
    const key = jobKey(j);
    setExtras((prev) => prev.filter((x) => jobKey(x) !== key));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  // Compute totals from selected only
  const { selectedCount, selectedCostCents } = useMemo(() => {
    let count = 0;
    let cost = 0;
    if (!plan) return { selectedCount: 0, selectedCostCents: 0 };
    for (const j of plan.jobs) {
      if (selected.has(jobKey(j))) {
        count++;
        cost += j.costCents;
      }
    }
    for (const j of extras) {
      if (selected.has(jobKey(j))) {
        count++;
        cost += j.costCents;
      }
    }
    return { selectedCount: count, selectedCostCents: cost };
  }, [plan, extras, selected]);

  const custoReais = (selectedCostCents / 100).toFixed(2);
  const budgetReais = spend ? (spend.budgetCents / 100).toFixed(2) : "0,00";
  const gastoReais = spend ? (spend.spentCents / 100).toFixed(2) : "0,00";
  const excederia = spend
    ? spend.spentCents + selectedCostCents > spend.budgetCents
    : false;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      // Build the jobs[] list from selection
      const jobsList: JobSelection[] = [];
      if (plan) {
        for (const j of plan.jobs) {
          if (selected.has(jobKey(j))) {
            jobsList.push({
              endpoint: j.endpoint,
              targetKind: j.targetKind as JobSelection["targetKind"],
              targetIndex: j.targetIndex,
            });
          }
        }
      }
      for (const j of extras) {
        if (selected.has(jobKey(j))) {
          jobsList.push({
            endpoint: j.endpoint,
            targetKind: j.targetKind as JobSelection["targetKind"],
            targetIndex: j.targetIndex,
          });
        }
      }
      await onConfirm(jobsList);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDefaultPlan = () => {
    selectAll();
  };

  // Set of endpoints already added per group key — used by picker to disable
  const alreadySelectedByGroup = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (j: PlannedJob) => {
      const gKey = `${j.targetKind}-${j.targetIndex}`;
      if (!map.has(gKey)) map.set(gKey, new Set());
      map.get(gKey)!.add(j.endpoint);
    };
    if (plan) plan.jobs.forEach(add);
    extras.forEach(add);
    return map;
  }, [plan, extras]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Extrair certidões via Infosimples</DialogTitle>
            <DialogDescription>
              Marque as certidões a extrair. Use &ldquo;+ Adicionar outras&rdquo; para
              incluir certidões de outras UFs ou categorias extras.
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculando plano de extração…
            </div>
          )}

          {!loading && plan && (
            <>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={handleDefaultPlan}>
                  Plano padrão
                </Button>
                <Button size="sm" variant="ghost" onClick={selectAll}>
                  Marcar todas
                </Button>
                <Button size="sm" variant="ghost" onClick={clearAll}>
                  Desmarcar
                </Button>
                {hasExtracted && (
                  <Button size="sm" variant="ghost" onClick={selectMissing}>
                    Só faltantes
                  </Button>
                )}
                <div className="flex-1" />
                <div className="text-xs text-muted-foreground">
                  {selectedCount} de {plan.jobs.length + extras.length} marcadas
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {grouped.map((g) => (
                  <div key={`${g.kind}-${g.index}`} className="rounded border">
                    <div className="flex items-center justify-between bg-muted/30 px-3 py-1.5 border-b">
                      <span className="text-xs font-semibold">{g.label}</span>
                      {g.kind !== "diligenciado" || diligenciados.length > 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => openPickerFor(g.kind, g.index, g.label)}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Adicionar outras
                        </Button>
                      ) : null}
                    </div>
                    <div className="p-2 space-y-1">
                      {g.jobs.map((j) => {
                        const isSelected = selected.has(jobKey(j));
                        const isExtra = extras.some((e) => jobKey(e) === jobKey(j));
                        return (
                          <label
                            key={jobKey(j)}
                            className={`flex items-center gap-2 text-xs cursor-pointer rounded px-2 py-1 hover:bg-muted/30 ${
                              isExtra ? "bg-blue-50/30 border border-blue-200" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleJob(j)}
                              className="h-3.5 w-3.5 accent-primary"
                            />
                            <span className="flex-1 truncate">{j.label}</span>
                            {(() => {
                              const h = apiHealth[j.endpoint];
                              if (h === "down" || h === "degraded") {
                                return (
                                  <span
                                    className={`shrink-0 text-[9px] ${
                                      h === "down"
                                        ? "text-red-600"
                                        : "text-amber-600"
                                    }`}
                                    title={
                                      h === "down"
                                        ? "API instável nas últimas 24h — pode falhar/atrasar"
                                        : "API com instabilidade recente"
                                    }
                                  >
                                    ● API
                                  </span>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const t = extractedStatus[jobKey(j)];
                              if (!t) return null;
                              const map = {
                                green: ["✓ emitida", "border-green-500 text-green-700"],
                                yellow: ["⏳ em andamento", "border-amber-500 text-amber-700"],
                                red: ["✗ falhou", "border-red-500 text-red-700"],
                                neutral: ["—", "text-muted-foreground"],
                              } as const;
                              const [txt, cls] = map[t];
                              return (
                                <Badge variant="outline" className={`text-[9px] ${cls}`}>
                                  {txt}
                                </Badge>
                              );
                            })()}
                            {isExtra && (
                              <Badge variant="outline" className="text-[9px]">
                                extra
                              </Badge>
                            )}
                            <span className="text-muted-foreground">
                              R$ {(j.costCents / 100).toFixed(2).replace(".", ",")}
                            </span>
                            {isExtra && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  removeExtra(j);
                                }}
                                className="text-destructive hover:bg-destructive/10 rounded p-0.5"
                                title="Remover extra"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {(() => {
                  // E4 — separa: (a) sem integração/API (não há endpoint p/ a
                  // praça → extrair no portal) vs (b) falta dado do formulário
                  // (endpoint existe, falta cpf/data_nascimento/sql → completar).
                  const isNoApi = (s: SkippedJob) =>
                    s.missingField === "cobertura" ||
                    /cobertura|sem integra|portal oficial|n[ãa]o emite|sem cobertura/i.test(
                      s.reason
                    );
                  const noApi = plan.skipped.filter(isNoApi);
                  const missingData = plan.skipped.filter((s) => !isNoApi(s));
                  return (
                    <>
                      {missingData.length > 0 && (
                        <div className="rounded border border-amber-200 bg-amber-50/40 p-3">
                          <h4 className="text-xs font-medium mb-1 flex items-center gap-1.5">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                            Faltam dados do formulário ({missingData.length})
                          </h4>
                          <ul className="text-[11px] space-y-0.5 text-muted-foreground">
                            {missingData.map((s, i) => (
                              <li key={i}>
                                <strong className="text-foreground">{s.label}</strong>:{" "}
                                {s.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {noApi.length > 0 && (
                        <div className="rounded border border-muted bg-muted/20 p-3">
                          <h4 className="text-xs font-medium mb-1 flex items-center gap-1.5">
                            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            Sem cobertura de API — extrair no portal ({noApi.length})
                          </h4>
                          <ul className="text-[11px] space-y-0.5 text-muted-foreground">
                            {noApi.map((s, i) => (
                              <li key={i}>
                                <strong className="text-foreground">{s.label}</strong>:{" "}
                                {s.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="shrink-0 rounded-md border bg-muted/20 p-3 text-sm flex items-center gap-3">
                <Wallet className="h-4 w-4" />
                <div className="flex-1">
                  <strong>Total:</strong> R$ {custoReais.replace(".", ",")} —{" "}
                  {selectedCount} certidão(ões)
                </div>
                {spend && (
                  <span className="text-xs text-muted-foreground">
                    Gasto: R$ {gastoReais.replace(".", ",")} / R${" "}
                    {budgetReais.replace(".", ",")}
                  </span>
                )}
                {excederia && (
                  <Badge variant="destructive" className="shrink-0">
                    Budget excedido
                  </Badge>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={
                submitting || loading || !plan || selectedCount === 0 || excederia
              }
              className="bg-green-600 hover:bg-green-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Iniciando…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Extrair {selectedCount} selecionadas
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pickerFor && (
        <ExtraCertidaoPicker
          open={!!pickerFor}
          onOpenChange={(open) => !open && setPickerFor(null)}
          catalog={catalog}
          catalogMeta={catalogMeta}
          alreadySelected={
            alreadySelectedByGroup.get(`${pickerFor.kind}-${pickerFor.index}`) ??
            new Set()
          }
          targetKind={pickerFor.kind === "imovel" ? "imovel" : "pessoa"}
          targetLabel={pickerFor.label}
          onConfirm={handleAddExtras}
        />
      )}
    </>
  );
}
