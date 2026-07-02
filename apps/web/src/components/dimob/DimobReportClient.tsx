"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, Download, FileText, Loader2, Trash2, RotateCcw, Users } from "lucide-react";
import { DimobRecordGrid, type ReviewRecord, type ReviewCell } from "./DimobRecordGrid";
import { DimobLeaseCard, type LeaseReviewRecord } from "./DimobLeaseCard";
import { DimobAssistant } from "./DimobAssistant";

type OverrideState = Record<string, Record<string, string>>;

interface Party {
  nome: string;
  cpfCnpj: string;
}
interface DimobRecord {
  dealId: string;
  dealTitle: string;
  comprador: Party;
  vendedor: Party;
  dataOperacao: string;
  valorAlienacao: number;
  valorComissao: number;
  commissionSource: string;
  needsReview: boolean;
  imovel: { endereco: string | null; uf: string | null };
}
interface Issue {
  level: "error" | "warning";
  scope: "declarante" | "operacao" | "locacao";
  field: string;
  message: string;
  dealId?: string;
  leaseId?: string;
}
interface Declarante {
  cnpj: string;
  nomeEmpresarial: string;
  uf: string;
  codigoMunicipio: string;
}
interface ExcludedSale {
  dealId: string;
  title: string;
  vendedor: string;
  comprador: string;
  valorAlienacao: number;
  dataOperacao: string;
  reason: string | null;
}
interface ExcludedLease {
  leaseId: string;
  locador: string;
  locatario: string;
  imovel: string | null;
  totalRendimento: number;
  reason: string | null;
}

interface PreviewResponse {
  year: number;
  declarante: Declarante;
  dispensado: boolean;
  records: DimobRecord[];
  reviewRecords: ReviewRecord[];
  leaseReviewRecords: LeaseReviewRecord[];
  excludedSales: ExcludedSale[];
  excludedLeases: ExcludedLease[];
  proprietariosNaDimob: number;
  issues: Issue[];
  layoutValidated: boolean;
  canGenerate: boolean;
}

const cpfCnpjMask = (d: string) =>
  d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export function DimobReportClient() {
  const currentYear = new Date().getFullYear();
  // Padrão: ano-calendário anterior (a DIMOB é do ano fechado).
  const [year, setYear] = useState(currentYear - 1);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [excludeTarget, setExcludeTarget] = useState<
    { title: string; dealId?: string; leaseId?: string } | null
  >(null);
  const [excludeReason, setExcludeReason] = useState("");
  const [excluding, setExcluding] = useState(false);
  const [reconciling, setReconciling] = useState<string | null>(null);
  const [selectedLeases, setSelectedLeases] = useState<Set<string>>(new Set());
  const [bulkExcluding, setBulkExcluding] = useState(false);

  /** Reconstrói o estado de overrides (vendas + locação) a partir do que veio marcado. */
  const deriveOverrides = (d: PreviewResponse | null): OverrideState => {
    const state: OverrideState = {};
    for (const r of d?.reviewRecords ?? []) {
      for (const c of r.cells) {
        if (c.overridden) {
          (state[r.recordId] ??= {})[c.key] = c.value;
        }
      }
    }
    for (const r of d?.leaseReviewRecords ?? []) {
      for (const m of r.meses) {
        if (m.aluguelOverridden) (state[r.recordId] ??= {})[`aluguel_${m.month}`] = String(m.aluguel);
        if (m.comissaoOverridden) (state[r.recordId] ??= {})[`comissao_${m.month}`] = String(m.comissao);
        if (m.impostoOverridden) (state[r.recordId] ??= {})[`imposto_${m.month}`] = String(m.imposto);
      }
    }
    return state;
  };

  const load = useCallback(async (y: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dimob/preview?year=${y}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao carregar prévia");
      }
      setData(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  async function putOverrides(state: OverrideState, savingKey: string) {
    setSavingKeys((s) => new Set(s).add(savingKey));
    try {
      const res = await fetch(`/api/dimob/overrides?year=${year}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao salvar edição");
      }
      await load(year); // re-valida + atualiza linha bruta + "era"
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSavingKeys((s) => {
        const n = new Set(s);
        n.delete(savingKey);
        return n;
      });
    }
  }

  function onCommit(recordId: string, fieldKey: string, value: string) {
    const state = deriveOverrides(data);
    (state[recordId] ??= {})[fieldKey] = value;
    void putOverrides(state, `${recordId}:${fieldKey}`);
  }

  function onReset(recordId: string, fieldKey: string) {
    const state = deriveOverrides(data);
    if (state[recordId]) {
      delete state[recordId][fieldKey];
      if (Object.keys(state[recordId]).length === 0) delete state[recordId];
    }
    void putOverrides(state, `${recordId}:${fieldKey}`);
  }

  async function onCorrigirOrigem(record: ReviewRecord, cell: ReviewCell) {
    if (!record.dealId) return;
    setSavingKeys((s) => new Set(s).add(`${record.recordId}:${cell.key}`));
    try {
      const res = await fetch(`/api/dimob/apply-to-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: record.dealId,
          fieldKey: cell.key,
          partyIndex: Number(cell.origin?.match(/\[(\d+)\]/)?.[1] ?? 0),
          value: cell.value,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Falha ao gravar no contrato");
      toast.success("Gravado no contrato de origem.");
      await load(year);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gravar no contrato");
    } finally {
      setSavingKeys((s) => {
        const n = new Set(s);
        n.delete(`${record.recordId}:${cell.key}`);
        return n;
      });
    }
  }

  useEffect(() => {
    void load(year);
  }, [year, load]);

  async function confirmExclude() {
    if (!excludeTarget) return;
    const isLease = Boolean(excludeTarget.leaseId);
    setExcluding(true);
    try {
      const res = await fetch(`/api/dimob/exclusions?year=${year}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLease
            ? { leaseId: excludeTarget.leaseId, reason: excludeReason.trim() || undefined }
            : { dealId: excludeTarget.dealId, reason: excludeReason.trim() || undefined }
        ),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao excluir");
      }
      toast.success(isLease ? "Contrato de locação excluído da DIMOB." : "Venda excluída da DIMOB.");
      setExcludeTarget(null);
      setExcludeReason("");
      await load(year);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir");
    } finally {
      setExcluding(false);
    }
  }

  async function reconcile(target: { dealId?: string; leaseId?: string } | "all") {
    const key = target === "all" ? "all" : (target.leaseId ?? target.dealId ?? "");
    setReconciling(key);
    try {
      const qs =
        target === "all"
          ? "all=true"
          : target.leaseId
            ? `leaseId=${target.leaseId}`
            : `dealId=${target.dealId}`;
      const res = await fetch(`/api/dimob/exclusions?year=${year}&${qs}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao reconciliar");
      }
      toast.success(target === "all" ? "Itens reconciliados." : "Item reconciliado.");
      await load(year);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao reconciliar");
    } finally {
      setReconciling(null);
    }
  }

  function toggleLease(record: LeaseReviewRecord) {
    setSelectedLeases((s) => {
      const n = new Set(s);
      if (n.has(record.leaseId)) n.delete(record.leaseId);
      else n.add(record.leaseId);
      return n;
    });
  }

  async function bulkExcludeLeases() {
    const ids = [...selectedLeases];
    if (ids.length === 0) return;
    setBulkExcluding(true);
    try {
      for (const leaseId of ids) {
        const res = await fetch(`/api/dimob/exclusions?year=${year}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leaseId }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "Falha ao excluir em lote");
        }
      }
      toast.success(`${ids.length} contrato${ids.length > 1 ? "s" : ""} de locação excluído${ids.length > 1 ? "s" : ""}.`);
      setSelectedLeases(new Set());
      await load(year);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir em lote");
    } finally {
      setBulkExcluding(false);
    }
  }

  async function markLayoutValidated() {
    try {
      const res = await fetch("/api/dimob/layout-validation", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao marcar");
      }
      toast.success("Leiaute marcado como validado.");
      await load(year);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao marcar");
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/dimob/generate?year=${year}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao gerar o arquivo");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `DIMOB_${year}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Arquivo DIMOB gerado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar");
    } finally {
      setGenerating(false);
    }
  }

  const errors = data?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = data?.issues.filter((i) => i.level === "warning") ?? [];
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-5">
      {/* Controles */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <label htmlFor="dimob-year" className="text-sm text-muted-foreground">
              Ano-calendário
            </label>
            <select
              id="dimob-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <Button
            onClick={generate}
            disabled={generating || loading || !data?.canGenerate}
          >
            {generating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Gerar TXT
          </Button>
        </CardContent>
      </Card>

      {/* Dispensa */}
      {data?.dispensado && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nenhuma operação de venda ou locação encontrada em {year}. A DIMOB é
            dispensada quando não há operações no ano-calendário (FAQ RFB p6).
          </CardContent>
        </Card>
      )}

      {/* Declarante */}
      {data && !data.dispensado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Declarante</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Razão social:</span>{" "}
              {data.declarante.nomeEmpresarial || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">CNPJ:</span>{" "}
              {data.declarante.cnpj ? cpfCnpjMask(data.declarante.cnpj) : "—"} ·{" "}
              <span className="text-muted-foreground">UF:</span> {data.declarante.uf || "—"} ·{" "}
              <span className="text-muted-foreground">Município:</span>{" "}
              {data.declarante.codigoMunicipio || "—"}
            </p>
            {errors.some((e) => e.scope === "declarante") && (
              <p className="pt-1 text-xs">
                <Link href="/settings/fiscal" className="font-medium text-primary underline">
                  Completar dados fiscais do declarante →
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pendências */}
      {(errors.length > 0 || warnings.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Pendências ({errors.length} bloqueiam · {warnings.length} avisos)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {errors.map((i, idx) => (
              <div key={`e${idx}`} className="flex items-start gap-2">
                <Badge variant="destructive" className="shrink-0">Bloqueia</Badge>
                <span>{i.message}</span>
              </div>
            ))}
            {warnings.map((i, idx) => (
              <div key={`w${idx}`} className="flex items-start gap-2">
                <Badge variant="secondary" className="shrink-0">Aviso</Badge>
                <span className="text-muted-foreground">{i.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Registros decodificados (revisão linha-a-linha) */}
      {data && !data.dispensado && data.reviewRecords.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Declarante + Vendas ({data.reviewRecords.length}) — revise e edite campo a campo
          </h2>
          <DimobRecordGrid
            records={data.reviewRecords}
            editable
            savingKeys={savingKeys}
            onCommit={onCommit}
            onReset={onReset}
            onCorrigirOrigem={onCorrigirOrigem}
            onExcludeSale={(record) => {
              setExcludeReason("");
              setExcludeTarget({ title: record.title, dealId: record.dealId ?? undefined });
            }}
          />
        </div>
      )}

      {/* Locação (R02) — um card por contrato×locador, tabela mensal editável */}
      {data && data.leaseReviewRecords.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              Locação (R02) — {data.leaseReviewRecords.length} contrato
              {data.leaseReviewRecords.length > 1 ? "s" : ""} · aluguéis mês a mês
              <Badge variant="secondary" className="gap-1 font-normal">
                <Users className="h-3 w-3" /> {data.proprietariosNaDimob} proprietário
                {data.proprietariosNaDimob > 1 ? "s" : ""} na DIMOB
              </Badge>
            </h2>
            {selectedLeases.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={bulkExcludeLeases}
                disabled={bulkExcluding}
              >
                {bulkExcluding ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-4 w-4" />
                )}
                Excluir selecionados ({selectedLeases.size})
              </Button>
            )}
          </div>
          {data.leaseReviewRecords.map((r) => (
            <DimobLeaseCard
              key={r.recordId}
              record={r}
              editable
              savingKeys={savingKeys}
              selected={selectedLeases.has(r.leaseId)}
              onToggleSelect={toggleLease}
              onCommit={onCommit}
              onReset={onReset}
              onExcludeLease={(record) => {
                setExcludeReason("");
                setExcludeTarget({ title: record.title, leaseId: record.leaseId });
              }}
            />
          ))}
        </div>
      )}

      {/* Locações excluídas da DIMOB (p/ reconciliar) */}
      {data && data.excludedLeases.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Locações excluídas da DIMOB ({data.excludedLeases.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.excludedLeases.map((l) => (
              <div
                key={l.leaseId}
                className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {l.locador || "—"} → {l.locatario || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {l.imovel ? `${l.imovel} · ` : ""}
                    {l.totalRendimento.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    {l.reason ? ` · motivo: ${l.reason}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => reconcile({ leaseId: l.leaseId })}
                  disabled={reconciling !== null}
                >
                  {reconciling === l.leaseId ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 h-4 w-4" />
                  )}
                  Reconciliar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Vendas excluídas da DIMOB (aparece mesmo em dispensa, p/ reconciliar) */}
      {data && data.excludedSales.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                Vendas excluídas da DIMOB ({data.excludedSales.length})
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => reconcile("all")}
                disabled={reconciling !== null}
              >
                {reconciling === "all" ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1 h-4 w-4" />
                )}
                Reconciliar todas
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.excludedSales.map((s) => (
              <div
                key={s.dealId}
                className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {s.vendedor || "—"} → {s.comprador || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.dataOperacao.split("-").reverse().join("/")} ·{" "}
                    {s.valorAlienacao.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    {s.reason ? ` · motivo: ${s.reason}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => reconcile({ dealId: s.dealId })}
                  disabled={reconciling !== null}
                >
                  {reconciling === s.dealId ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 h-4 w-4" />
                  )}
                  Reconciliar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Copiloto de IA */}
      {data && !data.dispensado && data.reviewRecords.length > 0 && (
        <DimobAssistant
          year={year}
          records={data.reviewRecords.map((r) => ({ recordId: r.recordId, title: r.title }))}
        />
      )}

      {/* Selo do leiaute */}
      {data?.layoutValidated ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          Leiaute validado no PGD DIMOB para esta versão.
        </p>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-3">
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            O leiaute do TXT é provisório e deve ser validado importando o arquivo no
            programa gerador oficial (PGD DIMOB) da Receita antes da entrega.
          </p>
          <Button size="sm" variant="outline" onClick={markLayoutValidated}>
            Marquei como validado no PGD
          </Button>
        </div>
      )}

      {/* Diálogo de exclusão de venda (motivo opcional) */}
      <Dialog
        open={!!excludeTarget}
        onOpenChange={(o) => {
          if (!o) setExcludeTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir venda da DIMOB</DialogTitle>
            <DialogDescription>
              {excludeTarget?.title} não entrará no arquivo gerado. Você pode reconciliar
              (re-incluir) depois.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Motivo (opcional)</label>
            <Textarea
              value={excludeReason}
              onChange={(e) => setExcludeReason(e.target.value)}
              rows={2}
              placeholder="Ex.: declarada por outra imobiliária, duplicada, cancelada…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcludeTarget(null)} disabled={excluding}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmExclude} disabled={excluding}>
              {excluding ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              Excluir da DIMOB
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
