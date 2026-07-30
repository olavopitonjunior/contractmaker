"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Sparkles,
  MapPin,
  UserPlus,
} from "lucide-react";
import { ExtraCertidaoPicker, type CatalogMeta } from "./ExtraCertidaoPicker";
import type { EndpointInfo } from "@/lib/certidoes/endpoints";
import { formPublicPath } from "@/lib/forms/form-url";

type Tier = "padrao" | "imovel" | "opcional" | "pesquisa";

// Redesign 2026-06-10 — a pop-up agrupa por PARTE (não por camada abstrata):
// Vendedores · Pessoas adicionais · Compradores · Imóvel · Pesquisa de bens.
// O grupo deriva de targetKind (+ tier pra separar imóvel/pesquisa), então o
// diligenciado ("Pessoas adicionais") aparece numa seção própria e visível —
// antes caía no tier "opcional" colapsado e sumia da vista.
type Group = "vendedores" | "adicionais" | "compradores" | "imovel" | "pesquisa";

const VENDEDOR_KINDS = new Set([
  "vendedor",
  "conjuge_vendedor",
  "procurador_vendedor",
  "representante_vendedor",
]);

// Default: Vendedores + Pessoas adicionais (quem o usuário adicionou de propósito)
// nascem pré-marcados; Compradores/Imóvel/Pesquisa entram via opt-in.
const DEFAULT_GROUPS: Set<Group> = new Set<Group>(["vendedores", "adicionais"]);

function groupForJob(j: { targetKind: string; tier?: Tier }): Group {
  if (j.tier === "pesquisa") return "pesquisa";
  if (j.tier === "imovel" || j.targetKind === "imovel") return "imovel";
  if (j.targetKind === "diligenciado") return "adicionais";
  if (VENDEDOR_KINDS.has(j.targetKind)) return "vendedores";
  return "compradores"; // comprador (e fallback defensivo)
}

interface JobRegion {
  kind: "nacional" | "imovel" | "endereco" | "outro";
  uf?: string;
  cidade?: string;
  label: string;
}

interface PlannedJob {
  endpoint: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  costCents: number;
  tier?: Tier;
  region?: JobRegion;
}

interface SkippedJob {
  endpoint: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  reason: string;
  missingField: string;
  tier?: Tier;
  region?: JobRegion;
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

interface ExtractCertidoesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /**
   * Cor da régua do job vivo por chave (endpoint|kind|index): green=já emitida,
   * yellow=em andamento, red=falhou. Marca o que já saiu.
   */
  extractedStatus?: Record<string, "green" | "yellow" | "red" | "neutral">;
  /**
   * Chaves (endpoint|kind|index) de alvos GENUINAMENTE em andamento (aguardando
   * o tribunal / em despacho). Travam o checkbox e ficam de fora do "Só as que
   * faltaram" — não se re-pede o que ainda vai voltar. Erros NÃO entram aqui.
   */
  inProgressKeys?: Set<string>;
  onConfirm: (jobs?: JobSelection[]) => Promise<void> | void;
  /** Abre o cadastro de "outras pessoas" (DiligentedPersonDialog) no parent. */
  onAddPerson?: () => void;
}

interface DiligentedRow {
  id: string;
  nome: string;
  tipoPessoa: string;
}

function jobKey(j: { endpoint: string; targetKind: string; targetIndex: number }) {
  return `${j.endpoint}|${j.targetKind}|${j.targetIndex}`;
}

const KIND_LABEL: Record<string, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  imovel: "Imóvel",
  diligenciado: "Pessoa adicional",
  conjuge_vendedor: "Cônjuge do vendedor",
  procurador_vendedor: "Procurador do vendedor",
  representante_vendedor: "Representante do vendedor",
};

function groupLabel(kind: string, index: number, labelMap: Record<string, string>): string {
  const key = `${kind}-${index}`;
  if (labelMap[key]) return labelMap[key];
  return `${KIND_LABEL[kind] ?? kind} ${index + 1}`;
}

// Ordena regiões: Nacional → imóvel → endereço → outro.
const REGION_ORDER: Record<string, number> = { nacional: 0, imovel: 1, endereco: 2, outro: 3 };
function regionHeader(r?: JobRegion): string {
  if (!r) return "Outros";
  if (r.kind === "nacional") return "Nacional";
  if (r.kind === "imovel") return `Região do imóvel — ${r.label}`;
  if (r.kind === "endereco") return `Região do endereço — ${r.label}`;
  return r.label || "Outro local";
}

const UF_OPTIONS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

export function ExtractCertidoesDialog({
  open,
  onOpenChange,
  dealId,
  extractedStatus = {},
  inProgressKeys,
  onConfirm,
  onAddPerson,
}: ExtractCertidoesDialogProps) {
  const [plan, setPlan] = useState<ExtractionPlan | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<ExtractionPlan | null>(null);
  const [catalog, setCatalog] = useState<EndpointInfo[]>([]);
  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta>({ ufs: [], categories: [] });
  const [diligenciados, setDiligenciados] = useState<DiligentedRow[]>([]);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [formToken, setFormToken] = useState<string | null>(null);
  const [apiHealth, setApiHealth] = useState<Record<string, "ok" | "degraded" | "down">>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<PlannedJob[]>([]);
  const [extraRegions, setExtraRegions] = useState<string[]>([]); // "UF" ou "UF|cidade"
  const [addingLocal, setAddingLocal] = useState(false);
  const [pickerFor, setPickerFor] = useState<{ kind: string; index: number; label: string } | null>(null);
  // Seções colapsáveis por parte. Vendedores + Pessoas adicionais abertas (o que
  // já vem marcado); Compradores/Imóvel/Pesquisa colapsadas pra reduzir o scroll —
  // abrem em 1 clique.
  const [openSections, setOpenSections] = useState<Record<Group, boolean>>({
    vendedores: true,
    adicionais: true,
    compradores: false,
    imovel: false,
    pesquisa: false,
  });

  const fetchPlan = (regions: string[]) => {
    setLoading(true);
    const qs = regions.length ? `&extraRegions=${encodeURIComponent(regions.join(";"))}` : "";
    fetch(`/api/deals/${dealId}/certidoes/plan?full=1${qs}`)
      .then((r) => r.json())
      .then((data) => {
        setPlan(data.plan);
        setExpandedPlan(data.expandedPlan ?? data.plan);
        setSpend(data.spend);
        setFormToken(data.formToken ?? null);
        setCatalog(data.catalog ?? []);
        setCatalogMeta(data.catalogMeta ?? { ufs: [], categories: [] });
        setApiHealth(data.apiHealth ?? {});
        setDiligenciados(data.diligenciados ?? []);
        // Default: marca os grupos Vendedores + Pessoas adicionais (quem o usuário
        // incluiu de propósito). Compradores/Imóvel/Pesquisa nascem desmarcados.
        const initial = new Set<string>(
          (data.plan?.jobs ?? [])
            // Não pré-marca alvos em andamento (aguardando o tribunal): o
            // checkbox fica travado e fora da contagem/custo.
            .filter(
              (j: PlannedJob) =>
                DEFAULT_GROUPS.has(groupForJob(j)) && !inProgressKeys?.has(jobKey(j))
            )
            .map((j: PlannedJob) => jobKey(j))
        );
        setSelected((prev) => {
          // Preserva escolhas explícitas do usuário ao re-planejar (add local).
          if (prev.size === 0) return initial;
          const merged = new Set(prev);
          for (const k of initial) merged.add(k);
          return merged;
        });
        setExtras([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setExtraRegions([]);
    fetchPlan([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dealId]);

  const targetLabels = useMemo(() => {
    const map: Record<string, string> = {};
    diligenciados.forEach((d, i) => {
      map[`diligenciado-${i}`] = `${d.nome}`;
    });
    if (plan) {
      for (const j of plan.jobs) {
        const key = `${j.targetKind}-${j.targetIndex}`;
        if (!map[key] && j.targetKind !== "diligenciado") {
          const match = j.label.match(/.*? - (.+)$/);
          if (match) {
            map[key] = `${KIND_LABEL[j.targetKind] ?? j.targetKind} ${j.targetIndex + 1}: ${match[1].split(" (")[0]}`;
          }
        }
      }
    }
    return map;
  }, [plan, diligenciados]);

  const allJobs = useMemo(() => {
    if (!plan) return [] as PlannedJob[];
    return [...plan.jobs, ...extras];
  }, [plan, extras]);

  const toggleJob = (j: PlannedJob) => {
    const key = jobKey(j);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setGroupSelection = (group: Group, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const j of allJobs) {
        if (groupForJob(j) === group) {
          // Não marca alvos travados (em andamento) ao "Marcar" o grupo todo.
          if (on && !inProgressKeys?.has(jobKey(j))) next.add(jobKey(j));
          else if (!on) next.delete(jobKey(j));
        }
      }
      return next;
    });
  };

  const selectMissing = () => {
    // "Só as que faltaram" reseleciona o que NÃO saiu (não-verde) e não está
    // genuinamente em andamento, DENTRO do escopo padrão. Tiers opt-in (Imóvel/
    // ONR, comprador, Pesquisa de Bens) NÃO entram aqui: o usuário inclui
    // abrindo a seção.
    // Mudança 2026-06-05: inclui agora os ERROS amarelos-retentáveis
    // (instabilidade/limite) — antes "amarelo" era excluído em bloco, deixando
    // de fora falhas transitórias. O que fica de fora é só o que está
    // realmente em andamento (inProgressKeys: aguardando o tribunal / em
    // despacho), espelhando a trava por alvo do backend.
    const next = new Set<string>();
    for (const j of allJobs) {
      if (!DEFAULT_GROUPS.has(groupForJob(j))) continue; // só Vendedores + Adicionais
      const key = jobKey(j);
      if (inProgressKeys?.has(key)) continue; // em andamento → não re-pedir
      const t = extractedStatus[key];
      if (t !== "green") next.add(key);
    }
    setSelected(next);
  };
  const hasExtracted = Object.keys(extractedStatus).length > 0;

  const handleAddExtras = (endpointIds: string[]) => {
    if (!pickerFor || !expandedPlan) return;
    const newExtras: PlannedJob[] = [];
    for (const ep of endpointIds) {
      const match = expandedPlan.jobs.find(
        (j) => j.endpoint === ep && j.targetKind === pickerFor.kind && j.targetIndex === pickerFor.index
      );
      if (match) {
        newExtras.push(match);
        setSelected((prev) => new Set(prev).add(jobKey(match)));
      }
    }
    setExtras((prev) => [...prev, ...newExtras]);
    setPickerFor(null);
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

  const addLocal = (uf: string) => {
    if (!uf || extraRegions.includes(uf)) return;
    const next = [...extraRegions, uf];
    setExtraRegions(next);
    setAddingLocal(false);
    fetchPlan(next);
  };

  const { selectedCount, selectedCostCents } = useMemo(() => {
    let count = 0;
    let cost = 0;
    for (const j of allJobs) {
      if (selected.has(jobKey(j))) {
        count++;
        cost += j.costCents;
      }
    }
    return { selectedCount: count, selectedCostCents: cost };
  }, [allJobs, selected]);

  const custoReais = (selectedCostCents / 100).toFixed(2);
  const budgetReais = spend ? (spend.budgetCents / 100).toFixed(2) : "0,00";
  const gastoReais = spend ? (spend.spentCents / 100).toFixed(2) : "0,00";
  const excederia = spend ? spend.spentCents + selectedCostCents > spend.budgetCents : false;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const jobsList: JobSelection[] = allJobs
        .filter((j) => selected.has(jobKey(j)))
        .map((j) => ({
          endpoint: j.endpoint,
          targetKind: j.targetKind as JobSelection["targetKind"],
          targetIndex: j.targetIndex,
        }));
      await onConfirm(jobsList);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const alreadySelectedByGroup = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const j of allJobs) {
      const gKey = `${j.targetKind}-${j.targetIndex}`;
      if (!map.has(gKey)) map.set(gKey, new Set());
      map.get(gKey)!.add(j.endpoint);
    }
    return map;
  }, [allJobs]);

  // Agrupa jobs por PARTE (kind-index) e, dentro de cada parte, por região.
  const byGroup = useMemo(() => {
    const out: Record<Group, PlannedJob[]> = {
      vendedores: [], adicionais: [], compradores: [], imovel: [], pesquisa: [],
    };
    for (const j of allJobs) out[groupForJob(j)].push(j);
    return out;
  }, [allJobs]);

  // Skips (não selecionáveis) por parte — pra mostrar Matrícula/IPTU/Bens e dados
  // faltantes como opções "falta X / indisponível" dentro da própria seção.
  const skipsByGroup = useMemo(() => {
    const out: Record<Group, SkippedJob[]> = {
      vendedores: [], adicionais: [], compradores: [], imovel: [], pesquisa: [],
    };
    for (const s of plan?.skipped ?? []) out[groupForJob(s)].push(s);
    return out;
  }, [plan]);

  const anyMissingData = useMemo(
    () =>
      (plan?.skipped ?? []).some(
        (s) =>
          s.missingField !== "cobertura" &&
          !/cobertura|sem integra|portal oficial|sem cobertura/i.test(s.reason)
      ),
    [plan]
  );

  const formUrl = formToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${formPublicPath(formToken)}`
    : null;

  // ---- renderers ----------------------------------------------------------
  // Remove o nome da pessoa/imóvel do rótulo (já está no cabeçalho do grupo).
  const stripLabel = (label: string, name?: string) =>
    name ? label.replace(` - ${name}`, "") : label;
  // Nome da pessoa/imóvel do grupo (para esconder no rótulo das linhas).
  const targetPersonName = (kind: string, idx: number): string | undefined => {
    const gl = groupLabel(kind, idx, targetLabels);
    const i = gl.indexOf(": ");
    return i >= 0 ? gl.slice(i + 2).trim() : undefined;
  };

  const renderJobRow = (j: PlannedJob, stripName?: string) => {
    const isSelected = selected.has(jobKey(j));
    const isExtra = extras.some((e) => jobKey(e) === jobKey(j));
    const h = apiHealth[j.endpoint];
    const t = extractedStatus[jobKey(j)];
    // Alvo genuinamente em andamento (aguardando o tribunal): trava o checkbox
    // — não dá pra re-pedir até voltar. Erros NÃO entram aqui (são retentáveis).
    const locked = inProgressKeys?.has(jobKey(j)) ?? false;
    const statusMap = {
      green: ["✓ emitida", "border-green-500 text-green-700"],
      yellow: ["⏳ em andamento", "border-amber-500 text-amber-700"],
      red: ["✗ falhou", "border-red-500 text-red-700"],
      neutral: ["—", "text-muted-foreground"],
    } as const;
    return (
      <label
        key={jobKey(j)}
        title={locked ? "Aguardando o tribunal — não é preciso pedir de novo" : undefined}
        className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${
          locked ? "cursor-default opacity-70" : "cursor-pointer hover:bg-muted/30"
        } ${isExtra ? "bg-blue-50/30 border border-blue-200" : ""}`}
      >
        <input
          type="checkbox"
          checked={isSelected && !locked}
          disabled={locked}
          onChange={() => toggleJob(j)}
          className="h-3.5 w-3.5 shrink-0 accent-primary"
        />
        <span className="flex-1 truncate min-w-0">{stripLabel(j.label, stripName)}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {(h === "down" || h === "degraded") && (
            <span
              className={`text-[9px] ${h === "down" ? "text-red-600" : "text-amber-600"}`}
              title={h === "down" ? "API instável nas últimas 24h" : "API com instabilidade recente"}
            >
              ● API
            </span>
          )}
          {t && (
            <Badge variant="outline" className={`text-[9px] ${statusMap[t][1]}`}>
              {statusMap[t][0]}
            </Badge>
          )}
          {isExtra && (
            <Badge variant="outline" className="text-[9px]">
              extra
            </Badge>
          )}
          <span className="text-muted-foreground tabular-nums">
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
        </span>
      </label>
    );
  };

  // Linha de SKIP (opção indisponível): mostra o que falta / por que não roda.
  const skipIsNoApi = (s: SkippedJob) =>
    s.missingField === "cobertura" ||
    /cobertura|sem integra|portal oficial|sem cobertura/i.test(s.reason);
  const renderSkipRow = (s: SkippedJob, stripName?: string) => (
    <div
      key={`skip-${s.endpoint}-${s.targetKind}-${s.targetIndex}`}
      className="flex items-center gap-2 text-xs rounded px-2 py-1 opacity-70"
      title={s.reason}
    >
      <input type="checkbox" disabled className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate min-w-0 text-muted-foreground">{stripLabel(s.label, stripName)}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        <Badge
          variant="outline"
          className={`text-[9px] ${
            skipIsNoApi(s) ? "text-muted-foreground" : "border-amber-400 text-amber-600"
          }`}
        >
          {skipIsNoApi(s) ? "no portal" : "faltam dados"}
        </Badge>
      </span>
    </div>
  );

  // Por alvo → por região (+ skips do alvo como "faltam dados"). Reusado pelos
  // grupos Vendedores e Pessoas adicionais (ambos diligenciam pessoas por região).
  const renderPersonRegionGroups = (
    jobs: PlannedJob[],
    skips: SkippedJob[],
    emptyMsg: string
  ) => {
    if (jobs.length === 0 && skips.length === 0)
      return <p className="text-xs text-muted-foreground px-1 py-2">{emptyMsg}</p>;
    const targets = new Map<string, { jobs: PlannedJob[]; skips: SkippedJob[] }>();
    const ensure = (k: string) => {
      if (!targets.has(k)) targets.set(k, { jobs: [], skips: [] });
      return targets.get(k)!;
    };
    for (const j of jobs) ensure(`${j.targetKind}-${j.targetIndex}`).jobs.push(j);
    for (const s of skips) ensure(`${s.targetKind}-${s.targetIndex}`).skips.push(s);
    return (
      <div className="space-y-2">
        {Array.from(targets.entries()).map(([tKey, { jobs: tJobs, skips: tSkips }]) => {
          const [kind, idxStr] = tKey.split("-");
          const idx = Number(idxStr);
          const regions = new Map<string, PlannedJob[]>();
          for (const j of tJobs) {
            const rk = j.region?.label ?? "outros";
            if (!regions.has(rk)) regions.set(rk, []);
            regions.get(rk)!.push(j);
          }
          const sortedRegions = Array.from(regions.entries()).sort(
            (a, b) =>
              (REGION_ORDER[a[1][0].region?.kind ?? "outro"] ?? 9) -
              (REGION_ORDER[b[1][0].region?.kind ?? "outro"] ?? 9)
          );
          const pName = targetPersonName(kind, idx);
          return (
            <div key={tKey} className="rounded border">
              <div className="bg-muted/30 px-3 py-1.5 border-b text-xs font-semibold">
                {groupLabel(kind, idx, targetLabels)}
              </div>
              <div className="p-2 space-y-2">
                {sortedRegions.map(([rLabel, rJobs]) => (
                  <div key={rLabel}>
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground px-1 mb-0.5">
                      <MapPin className="h-3 w-3" />
                      {regionHeader(rJobs[0].region)}
                    </div>
                    <div className="space-y-0.5">{rJobs.map((j) => renderJobRow(j, pName))}</div>
                  </div>
                ))}
                {tSkips.length > 0 && (
                  <div className="space-y-0.5">{tSkips.map((s) => renderSkipRow(s, pName))}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Vendedores: pessoas por região + "Adicionar outro local" (re-planeja com UF extra).
  const renderVendedores = () => (
    <div className="space-y-2">
      {renderPersonRegionGroups(
        byGroup.vendedores,
        skipsByGroup.vendedores,
        "Nenhum vendedor para diligenciar neste negócio."
      )}
      <div className="flex flex-wrap items-center gap-2 px-1">
        {addingLocal ? (
          <span className="flex items-center gap-1">
            <select
              className="h-7 rounded border bg-background text-xs px-1"
              defaultValue=""
              onChange={(e) => addLocal(e.target.value)}
            >
              <option value="" disabled>
                UF…
              </option>
              {UF_OPTIONS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAddingLocal(false)}>
              Cancelar
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddingLocal(true)}>
            <MapPin className="h-3 w-3 mr-1" />
            Adicionar outro local
          </Button>
        )}
        {extraRegions.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            Locais extras: {extraRegions.join(", ")}
          </span>
        )}
      </div>
    </div>
  );

  // Pessoas adicionais (diligenciados): pessoas por região + botão de cadastro.
  const renderAdicionais = () => (
    <div className="space-y-2">
      {renderPersonRegionGroups(
        byGroup.adicionais,
        skipsByGroup.adicionais,
        "Nenhuma pessoa adicional. Inclua sócios, avalistas ou procuradores externos ao contrato."
      )}
      {onAddPerson && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={onAddPerson}
        >
          <UserPlus className="h-3 w-3 mr-1" />
          Adicionar outras pessoas
        </Button>
      )}
    </div>
  );

  // Opcional / Pesquisa: por alvo (jobs + skips), com botão "+ Adicionar outras".
  const renderByTarget = (
    jobs: PlannedJob[],
    skips: SkippedJob[],
    opts: { picker?: boolean } = {}
  ) => {
    if (jobs.length === 0 && skips.length === 0)
      return <p className="text-xs text-muted-foreground px-1 py-2">Nada aqui.</p>;
    const targets = new Map<string, { jobs: PlannedJob[]; skips: SkippedJob[] }>();
    const ensure = (k: string) => {
      if (!targets.has(k)) targets.set(k, { jobs: [], skips: [] });
      return targets.get(k)!;
    };
    for (const j of jobs) ensure(`${j.targetKind}-${j.targetIndex}`).jobs.push(j);
    for (const s of skips) ensure(`${s.targetKind}-${s.targetIndex}`).skips.push(s);
    return (
      <div className="space-y-2">
        {Array.from(targets.entries()).map(([tKey, { jobs: tJobs, skips: tSkips }]) => {
          const [kind, idxStr] = tKey.split("-");
          const idx = Number(idxStr);
          return (
            <div key={tKey} className="rounded border">
              <div className="flex items-center justify-between bg-muted/30 px-3 py-1.5 border-b">
                <span className="text-xs font-semibold">{groupLabel(kind, idx, targetLabels)}</span>
                {opts.picker && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setPickerFor({ kind, index: idx, label: groupLabel(kind, idx, targetLabels) })}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Adicionar outras
                  </Button>
                )}
              </div>
              <div className="p-2 space-y-0.5">
                {tJobs.map((j) => renderJobRow(j, targetPersonName(kind, idx)))}
                {tSkips.map((s) => renderSkipRow(s, targetPersonName(kind, idx)))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const Section = ({
    group,
    title,
    desc,
    children,
  }: {
    group: Group;
    title: string;
    desc?: string;
    children: ReactNode;
  }) => {
    const jobs = byGroup[group];
    const groupSkips = skipsByGroup[group];
    const groupSelected = jobs.filter((j) => selected.has(jobKey(j))).length;
    const allSelected = jobs.length > 0 && groupSelected === jobs.length;
    const isOpen = openSections[group];
    return (
      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/20 rounded-t-lg">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-semibold min-w-0 uppercase tracking-wide"
            onClick={() => setOpenSections((s) => ({ ...s, [group]: !s[group] }))}
          >
            {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <span className="truncate">{title}</span>
            {allSelected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />}
          </button>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            [{groupSelected}/{jobs.length}]
            {groupSkips.length > 0 && (
              <span className="text-amber-600"> · {groupSkips.length} c/ pendência</span>
            )}
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setGroupSelection(group, true)}>
              Marcar
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setGroupSelection(group, false)}>
              Limpar
            </Button>
          </div>
        </div>
        {desc && isOpen && <p className="text-[11px] text-muted-foreground px-3 pt-2">{desc}</p>}
        {isOpen && <div className="p-2">{children}</div>}
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[88vh] overflow-hidden flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Emitir certidões</DialogTitle>
            <DialogDescription>
              <strong>Vendedores</strong> e <strong>pessoas adicionais</strong> já vêm marcados. Compradores,
              imóvel e pesquisa de bens são opções — abra cada seção para incluir.
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculando plano de certidões…
            </div>
          )}

          {!loading && plan && (
            <>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {hasExtracted && (
                  <Button size="sm" variant="outline" onClick={selectMissing}>
                    Só as que faltaram
                  </Button>
                )}
                {anyMissingData && formUrl && (
                  <a
                    href={formUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    title="Abre o formulário do negócio em nova aba para completar os dados que faltam"
                  >
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                    Completar dados no formulário
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <div className="flex-1" />
                <div className="text-xs text-muted-foreground">{selectedCount} marcada(s)</div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
                <Section
                  group="vendedores"
                  title="Vendedores"
                  desc="Certidões dos vendedores (e dependentes) na região do imóvel e na do endereço deles."
                >
                  {renderVendedores()}
                </Section>

                <Section
                  group="adicionais"
                  title="Pessoas adicionais"
                  desc="Pessoas externas ao contrato que você incluiu (sócios, avalistas, procuradores)."
                >
                  {renderAdicionais()}
                </Section>

                <Section
                  group="compradores"
                  title="Compradores"
                  desc="Certidões dos compradores — inclua se quiser diligenciá-los."
                >
                  {renderByTarget(byGroup.compradores, skipsByGroup.compradores, { picker: true })}
                </Section>

                <Section
                  group="imovel"
                  title="Imóvel"
                  desc="Matrícula (visualização ONR), IPTU e tributos municipais do imóvel, CCIR."
                >
                  {renderByTarget(byGroup.imovel, skipsByGroup.imovel, { picker: true })}
                </Section>

                <Section
                  group="pesquisa"
                  title="Pesquisa de bens"
                  desc="Pesquisa de Bens (ONR) e certidões menos comuns."
                >
                  {renderByTarget(byGroup.pesquisa, skipsByGroup.pesquisa, { picker: true })}
                </Section>

                {/* Em breve — Serasa */}
                <div className="rounded-lg border border-dashed bg-muted/10 px-3 py-2.5 opacity-80">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-semibold">Pesquisa Serasa</span>
                    <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-600">
                      Em breve
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Localizar empresas relacionadas aos vendedores e automatizar a busca de certidões.
                  </p>
                </div>

              </div>

              <div className="shrink-0 rounded-md border bg-muted/20 p-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                <Wallet className="h-4 w-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <strong>Total:</strong> R$ {custoReais.replace(".", ",")} — {selectedCount} certidão(ões)
                </div>
                {spend && (
                  <span className="text-xs text-muted-foreground">
                    Gasto: R$ {gastoReais.replace(".", ",")} / R$ {budgetReais.replace(".", ",")}
                  </span>
                )}
                {excederia && (
                  <Badge variant="destructive" className="shrink-0">
                    Orçamento excedido
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
              disabled={submitting || loading || !plan || selectedCount === 0 || excederia}
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
                  Emitir {selectedCount} selecionada(s)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pickerFor && (
        <ExtraCertidaoPicker
          open={!!pickerFor}
          onOpenChange={(o) => !o && setPickerFor(null)}
          catalog={catalog}
          catalogMeta={catalogMeta}
          alreadySelected={alreadySelectedByGroup.get(`${pickerFor.kind}-${pickerFor.index}`) ?? new Set()}
          targetKind={pickerFor.kind === "imovel" ? "imovel" : "pessoa"}
          targetLabel={pickerFor.label}
          onConfirm={handleAddExtras}
        />
      )}
    </>
  );
}
