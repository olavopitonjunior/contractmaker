"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  SkipForward,
  RefreshCw,
  FileText,
  Wallet,
  ExternalLink,
  AlertTriangle,
  Sparkles,
  Download,
  Share2,
  Trash2,
  CalendarClock,
  Archive,
  Eye,
  LifeBuoy,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useCertidoesBatch, type CertidaoJobRow } from "@/hooks/useCertidoesBatch";
import { ExtractCertidoesDialog, type JobSelection } from "./ExtractCertidoesDialog";
import { CertidaoDetailDialog } from "./CertidaoDetailDialog";
import { ComplementDadosForm } from "./ComplementDadosForm";
import { ShareCertidoesDialog } from "./ShareCertidoesDialog";
import { DiligentedPersonsSection } from "./DiligentedPersonsSection";
import { EditPartyDialog } from "./EditPartyDialog";
import {
  CATEGORY_LABEL,
  isUserFixable,
  type FailureCategory,
} from "@/lib/certidoes/error-codes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CertidoesTabProps {
  dealId: string;
  vendedores: Array<{ nome?: string; razao_social?: string }>;
  compradores: Array<{ nome?: string; razao_social?: string }>;
  imoveis: Array<{
    rua?: string;
    numero?: string;
    cidade?: string;
  }>;
}

function imovelLabel(im: {
  rua?: string;
  numero?: string;
  cidade?: string;
}, index: number): string {
  const parts: string[] = [];
  if (im.rua) parts.push(im.rua);
  if (im.numero && im.numero.trim() !== "" && im.numero.trim() !== "nº") {
    parts.push(`nº ${im.numero}`);
  }
  if (im.cidade) parts.push(im.cidade);
  const label = parts.join(", ");
  return label || `Imóvel #${index + 1}`;
}

const STALE_AFTER_MS = 5 * 60_000;

function statusIcon(row: CertidaoJobRow) {
  const status = effectiveStatus(row);
  switch (status) {
    case "success": {
      const r = row.resultData as { situacao?: string } | null;
      if (r?.situacao === "aguardando_pdf") {
        return <Clock className="h-4 w-4 text-blue-600" />;
      }
      // H.12 (Phase H, 2026-04-18) — nao_emitida não pode exibir ✓ verde:
      // significa que o portal NÃO emitiu a certidão (normalmente 6xx
      // mapeado para missing_input/portal_unavailable). Evita UX ambíguo.
      if (r?.situacao === "nao_emitida") {
        return <XCircle className="h-4 w-4 text-red-600" />;
      }
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    }
    case "failed":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "fetching":
    case "pending":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
    case "awaiting_portal":
      return <Clock className="h-4 w-4 text-amber-600" />;
    case "skipped":
      return <SkipForward className="h-4 w-4 text-muted-foreground" />;
    case "replaced":
      return <Archive className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatDateBR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("pt-BR");
  } catch {
    return null;
  }
}

// A row has "valid data" when the backend has persisted a recognized
// `situacao` — even if the job's status field still says "fetching" (race
// with the container dying right after the Prisma update). The UI trusts
// resultData over status whenever both exist.
function hasValidResult(row: CertidaoJobRow): boolean {
  const r = row.resultData as { situacao?: string } | null;
  if (!r || typeof r.situacao !== "string") return false;
  return (
    row.resultCode === 200 &&
    ["negativa", "positiva", "positiva_com_efeitos", "nao_emitida", "aguardando_pdf"].includes(
      r.situacao
    )
  );
}

function effectiveStatus(row: CertidaoJobRow): CertidaoJobRow["status"] {
  // Protect against "ghost fetching": when the backend has valid data but the
  // job row's status is still non-terminal (container died before finishing
  // the update, or polling caught a stale row), trust the data.
  if (
    (row.status === "fetching" || row.status === "pending") &&
    hasValidResult(row)
  ) {
    return "success";
  }
  return row.status;
}

/**
 * Phase F.II-α — estado "Pendente" unificado: pending, fetching e
 * awaiting_portal todos viram "Pendente" na UI, com subtítulo específico.
 * Evita que o usuário interprete "aguardando_portal" como erro.
 */
function statusLabel(row: CertidaoJobRow): string {
  const r = row.resultData as { situacao?: string; detalhes?: string } | null;
  const status = effectiveStatus(row);
  if (status === "failed") return row.errorMessage || "Erro";
  if (status === "pending") return "Pendente · na fila";
  if (status === "fetching") return "Pendente · consultando";
  if (status === "awaiting_portal") {
    // Subtítulo específico por endpoint — TJSP ~15min, TJRJ ~8d, TJMS ~2d
    const ep = row.endpoint.toLowerCase();
    if (ep.includes("tjrj")) return "Pendente · aguardando portal (até 8 dias úteis)";
    if (ep.includes("tjms")) return "Pendente · aguardando portal (até 48h)";
    return "Pendente · aguardando portal (até 15 min)";
  }
  if (status === "skipped") return row.errorMessage || "Pulado — dados faltantes";
  if (status === "replaced") return "Substituído";
  if (status === "success") {
    switch (r?.situacao) {
      case "negativa":
        return "Negativa · nada consta";
      case "positiva":
        return "Positiva · consta débito";
      case "positiva_com_efeitos":
        return "Positiva com efeitos de negativa";
      case "nao_emitida":
        return "Não emitida pelo portal";
      case "aguardando_pdf":
        return "Negativa · aguardando PDF";
      case "informativa":
        return "Consulta informativa";
      default:
        return r?.detalhes || "Concluído";
    }
  }
  return "—";
}

/**
 * When a job succeeded at the transport layer but the portal didn't emit
 * (situacao "nao_emitida" / "indeterminado"), the normalizer attaches a
 * `failureCategory` explaining why. This tint colors the card accordingly so
 * the user can see "needs data" vs "portal down" vs "limit reached" at a
 * glance without opening the detail dialog.
 */
function variantForFailureCategory(cat: FailureCategory | undefined): string | null {
  switch (cat) {
    case "missing_input":
    case "inconsistent_input":
      return "border-amber-300 bg-amber-50/40";
    case "portal_unavailable":
    case "rate_limited":
      return "border-blue-300 bg-blue-50/30";
    case "account_issue":
      return "border-red-300 bg-red-50";
    case "genuine_no_data":
      return "border-green-300 bg-green-50/30";
    case "unknown":
    case undefined:
    default:
      return null;
  }
}

function statusVariant(row: CertidaoJobRow): string {
  const r = row.resultData as { situacao?: string; failureCategory?: FailureCategory } | null;
  const status = effectiveStatus(row);
  if (status === "failed") return "border-red-300 bg-red-50";
  if (status === "awaiting_portal") return "border-amber-300 bg-amber-50";
  if (status === "fetching" || status === "pending")
    return "border-blue-300 bg-blue-50/30";
  if (status === "skipped") return "border-muted bg-muted/20";
  if (status === "replaced") return "border-muted bg-muted/10 opacity-60";
  if (status === "success") {
    if (r?.situacao === "negativa") return "border-green-300 bg-green-50/30";
    if (r?.situacao === "aguardando_pdf") return "border-blue-300 bg-blue-50/30";
    if (r?.situacao === "informativa") return "border-blue-300 bg-blue-50/20";
    if (r?.situacao === "positiva" || r?.situacao === "positiva_com_efeitos")
      return "border-amber-300 bg-amber-50";
    // "nao_emitida" / "indeterminado" — use category-specific tint when available
    const catVariant = variantForFailureCategory(r?.failureCategory);
    if (catVariant) return catVariant;
    return "border-muted bg-background";
  }
  return "border-muted bg-muted/20";
}

/**
 * Returns the failureCategory when a job needs category-specific UX. Only set
 * on success responses where the situacao is a failure-like state — for
 * status === "failed" (transport error) the category is left undefined.
 */
function getFailureCategory(row: CertidaoJobRow): FailureCategory | undefined {
  const r = row.resultData as { failureCategory?: FailureCategory } | null;
  return r?.failureCategory;
}

function groupKey(row: CertidaoJobRow): string {
  return `${row.targetKind}-${row.targetIndex}`;
}

function isStuck(row: CertidaoJobRow): boolean {
  const status = effectiveStatus(row);
  if (status !== "fetching" && status !== "pending") return false;
  const started = new Date(row.createdAt).getTime();
  return Date.now() - started > STALE_AFTER_MS;
}

// Median + outlier filter for latency display. Filters out nulls and values
// that are >3x the median (e.g. CENPROT SP 1071s when most are ~20s).
function medianLatency(jobs: CertidaoJobRow[]): number {
  const values = jobs
    .map((j) => j.latencyMs)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  // Filter out outliers (>3x median) and recompute
  const filtered = values.filter((v) => v <= median * 3);
  if (filtered.length === 0) return Math.round(median / 1000);
  const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  return Math.round(avg / 1000);
}

export function CertidoesTab({
  dealId,
  vendedores,
  compradores,
  imoveis,
}: CertidoesTabProps) {
  const {
    jobs,
    loading,
    error,
    extract,
    retry,
    deleteJob,
    sweepStale,
    completeSkipped,
    refresh,
  } = useCertidoesBatch(dealId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [detailJob, setDetailJob] = useState<CertidaoJobRow | null>(null);
  const [complementJobId, setComplementJobId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Phase A: editing party inline from the certidão card when the portal
  // returned "inconsistent_input" (nome/data nascimento divergente). Opens
  // EditPartyDialog pre-filled with the current party snapshot; on save,
  // PATCHes the deal and retries the job.
  const [editingPartyJob, setEditingPartyJob] = useState<CertidaoJobRow | null>(null);

  const visibleJobs = useMemo(
    () => jobs.filter((j) => j.status !== "replaced"),
    [jobs]
  );

  const groups = useMemo(() => {
    // Phase F.II-α: agrupamento fixo em 3 categorias — Vendedor, Comprador,
    // Diligência Avulsa. Imóvel removido (não há mais certidões de imóvel).
    // Jobs com targetKind="imovel" (legacy antes da mudança do planner) caem
    // no grupo "Outras" defensivo.
    const map = new Map<string, { label: string; rows: CertidaoJobRow[] }>();
    vendedores.forEach((v, i) =>
      map.set(`vendedor-${i}`, {
        label: `Vendedor: ${v.nome || v.razao_social || `Parte ${i + 1}`}`,
        rows: [],
      })
    );
    compradores.forEach((c, i) =>
      map.set(`comprador-${i}`, {
        label: `Comprador: ${c.nome || c.razao_social || `Parte ${i + 1}`}`,
        rows: [],
      })
    );
    for (const job of visibleJobs) {
      // F.II-α: drop jobs de imóvel legacy (não aparecem mais na UI)
      if (job.targetKind === "imovel") continue;
      const key = groupKey(job);
      if (!map.has(key)) {
        // Diligenciados têm groupKey "diligenciado-N" — label amigável
        const label =
          job.targetKind === "diligenciado"
            ? `Diligência avulsa #${job.targetIndex + 1}`
            : `${job.targetKind} ${job.targetIndex + 1}`;
        map.set(key, { label, rows: [] });
      }
      map.get(key)!.rows.push(job);
    }
    return Array.from(map.entries()).filter(([, g]) => g.rows.length > 0);
  }, [visibleJobs, vendedores, compradores]);

  const stats = useMemo(() => {
    const total = visibleJobs.length;
    // Count by EFFECTIVE status (trusts resultData over job.status)
    const success = visibleJobs.filter(
      (j) => effectiveStatus(j) === "success"
    ).length;
    const failed = visibleJobs.filter(
      (j) => effectiveStatus(j) === "failed"
    ).length;
    const awaiting = visibleJobs.filter(
      (j) => effectiveStatus(j) === "awaiting_portal"
    ).length;
    const fetching = visibleJobs.filter((j) => {
      const s = effectiveStatus(j);
      return s === "fetching" || s === "pending";
    }).length;
    const skipped = visibleJobs.filter(
      (j) => effectiveStatus(j) === "skipped"
    ).length;
    const stuck = visibleJobs.filter(isStuck).length;
    // Count ghost-data jobs: raw status says fetching/pending but data is valid.
    // These would be auto-promoted by sweeper or the UI already reads them as
    // success. Used to drive the "Recuperar travadas" UX.
    const ghostPromotable = visibleJobs.filter(
      (j) =>
        (j.status === "fetching" || j.status === "pending") &&
        hasValidResult(j)
    ).length;
    const cost = visibleJobs.reduce((a, j) => a + (j.costCents ?? 0), 0);
    const avgLatency = medianLatency(visibleJobs);
    return {
      total,
      success,
      failed,
      awaiting,
      fetching,
      skipped,
      stuck,
      ghostPromotable,
      cost,
      avgLatency,
    };
  }, [visibleJobs]);

  const handleExtract = async (jobs?: JobSelection[]) => {
    if (extracting) return;
    setExtracting(true);
    try {
      const result = await extract(jobs);
      if (result) {
        toast.success(`Iniciando ${result.jobCount} certidões…`);
      }
    } finally {
      setExtracting(false);
    }
  };

  const handleReport = async () => {
    setGeneratingReport(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/certidoes/report`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao gerar relatório");
        return;
      }
      toast.success("Relatório gerado");
      if (data.fileUrl) window.open(data.fileUrl, "_blank");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao gerar relatório"
      );
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleDownloadZip = () => {
    window.location.href = `/api/deals/${dealId}/certidoes/zip`;
    toast.success("Baixando todas as certidões…");
  };

  const handleRetry = async (row: CertidaoJobRow) => {
    const result = await retry(row.id);
    if (!result.ok) {
      toast.error(result.error || "Erro ao tentar novamente");
      return;
    }
    toast.success("Tentativa iniciada");
  };

  /**
   * Phase G.2 — bulk retry por categoria de falha ou por status.
   * Chama POST /api/deals/:id/certidoes/bulk-retry primeiro em dry-run
   * (para confirmar com usuário) e depois dispara em modo real.
   */
  const handleBulkRetry = async (
    filter: { category?: string; status?: "failed" | "skipped" },
    label: string
  ) => {
    try {
      const dryRes = await fetch(
        `/api/deals/${dealId}/certidoes/bulk-retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...filter, dryRun: true }),
        }
      );
      const dryData = await dryRes.json();
      if (!dryRes.ok) {
        toast.error(dryData.error || "Erro no dry-run");
        return;
      }
      const retriable = dryData.retriable ?? 0;
      const skipped = dryData.skippedByRetry ?? 0;
      if (retriable === 0) {
        toast.info(
          `Nenhum job elegível para retry em "${label}"${
            skipped > 0 ? ` (${skipped} já atingiram MAX_RETRIES)` : ""
          }`
        );
        return;
      }
      if (
        !window.confirm(
          `Retry em massa: ${label}\n\n${retriable} job(s) serão re-executados.${
            skipped > 0 ? ` ${skipped} skipped por MAX_RETRIES.` : ""
          }\n\nConfirma? (custo adicional ≈ R$ ${(retriable * 0.05).toFixed(2).replace(".", ",")})`
        )
      ) {
        return;
      }
      const res = await fetch(
        `/api/deals/${dealId}/certidoes/bulk-retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(filter),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro no bulk retry");
        return;
      }
      toast.success(`${data.dispatched} job(s) disparados`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    }
  };

  const handleSweep = async () => {
    // H.7 (Phase H, 2026-04-18) — dry-run via stats antes de executar; evita
    // ação silenciosa do QA anterior (botão clicado sem feedback visível).
    const stuck = stats.stuck;
    const promotable = stats.ghostPromotable;
    const willFail = Math.max(0, stuck - promotable);
    const confirmMsg =
      `Analisar ${Math.max(stuck, promotable)} job(s) travado(s):\n\n` +
      `• ${promotable} serão promovidos para sucesso (sem custo)\n` +
      `• ${willFail} serão marcados como falha e liberados para retry\n\n` +
      `Confirma?`;
    if (!window.confirm(confirmMsg)) return;
    const result = await sweepStale();
    if (result.promoted > 0 && result.failed > 0) {
      toast.success(
        `${result.promoted} já resolvida(s) promovida(s) para sucesso; ${result.failed} realmente falha(s) marcada(s)`
      );
    } else if (result.promoted > 0) {
      toast.success(
        `${result.promoted} certidão(ões) tinha(m) resultado válido no banco — visualização atualizada sem novas chamadas`
      );
    } else if (result.failed > 0) {
      toast.success(
        `${result.failed} certidão(ões) travada(s) marcada(s) como falha. Clique em tentar novamente em cada card.`
      );
    } else {
      toast.info("Nenhuma certidão travada encontrada");
    }
  };

  const handleDelete = async (row: CertidaoJobRow) => {
    setDeletingId(row.id);
    try {
      const ok = await deleteJob(row.id);
      if (ok) {
        toast.success("Job removido");
      } else {
        toast.error("Falha ao remover");
      }
    } finally {
      setDeletingId(null);
    }
  };

  const hasJobs = visibleJobs.length > 0;

  return (
    <div className="space-y-4">
      {/* F3: diligenciados section at the top */}
      <DiligentedPersonsSection dealId={dealId} onChange={() => refresh()} />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDialogOpen(true)} disabled={extracting}>
          <Sparkles className="h-4 w-4 mr-1" />
          {hasJobs ? "Extrair novamente" : "Extrair certidões"}
        </Button>
        {hasJobs && (
          <Button variant="outline" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Atualizar
          </Button>
        )}
        {(stats.stuck > 0 || stats.ghostPromotable > 0) && (
          <Button
            variant="outline"
            onClick={handleSweep}
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            title={
              stats.ghostPromotable > 0
                ? `${stats.ghostPromotable} já têm resultado válido e serão promovidas sem custo`
                : "Marca como falha e libera botão de retry"
            }
          >
            <LifeBuoy className="h-4 w-4 mr-1" />
            Recuperar travadas ({Math.max(stats.stuck, stats.ghostPromotable)})
          </Button>
        )}
        {/* G.2 — bulk retry por categoria quando houver failed ou skipped */}
        {(stats.failed > 0 || stats.skipped > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <RefreshCw className="h-4 w-4 mr-1" />
                Retry em massa
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs">
                Por categoria de falha
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() =>
                  handleBulkRetry(
                    { category: "portal_unavailable" },
                    "Portal indisponível"
                  )
                }
              >
                Portal indisponível
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  handleBulkRetry(
                    { category: "provider_timeout" },
                    "Timeout do provedor"
                  )
                }
              >
                Timeout do provedor
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  handleBulkRetry(
                    { category: "rate_limited" },
                    "Limite atingido"
                  )
                }
              >
                Limite atingido
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  handleBulkRetry(
                    { category: "integration_error" },
                    "Erro do sistema"
                  )
                }
              >
                Erro do sistema (nosso)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">
                Por status
              </DropdownMenuLabel>
              {stats.failed > 0 && (
                <DropdownMenuItem
                  onSelect={() =>
                    handleBulkRetry({ status: "failed" }, `Todos failed (${stats.failed})`)
                  }
                >
                  Todos failed ({stats.failed})
                </DropdownMenuItem>
              )}
              {stats.skipped > 0 && (
                <DropdownMenuItem
                  onSelect={() =>
                    handleBulkRetry({ status: "skipped" }, `Todos skipped (${stats.skipped})`)
                  }
                >
                  Todos skipped ({stats.skipped})
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {stats.success > 0 && (
          <>
            <Button
              variant="outline"
              onClick={handleReport}
              disabled={generatingReport}
            >
              <FileText className="h-4 w-4 mr-1" />
              {generatingReport ? "Gerando…" : "Gerar relatório"}
            </Button>
            <Button variant="outline" onClick={handleDownloadZip}>
              <Download className="h-4 w-4 mr-1" />
              Baixar todas (ZIP)
            </Button>
            <Button variant="outline" onClick={() => setShareOpen(true)}>
              <Share2 className="h-4 w-4 mr-1" />
              Compartilhar
            </Button>
          </>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {hasJobs && (
        <Card>
          <CardContent className="py-3 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <strong>{stats.success}</strong>/{stats.total} sucesso
            </div>
            {stats.failed > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle className="h-4 w-4 text-red-600" />
                <strong>{stats.failed}</strong> falhas
              </div>
            )}
            {stats.fetching > 0 && (
              <div className="flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                <strong>{stats.fetching}</strong> em andamento
              </div>
            )}
            {stats.awaiting > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-amber-600" />
                <strong>{stats.awaiting}</strong> aguardando portal
              </div>
            )}
            {stats.skipped > 0 && (
              <div className="flex items-center gap-1.5">
                <SkipForward className="h-4 w-4 text-muted-foreground" />
                <strong>{stats.skipped}</strong> pulado(s)
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Wallet className="h-4 w-4" />R${" "}
              {(stats.cost / 100).toFixed(2).replace(".", ",")}
            </div>
            {stats.avgLatency > 0 && (
              <div className="text-muted-foreground">
                Latência média: {stats.avgLatency}s
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!hasJobs && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>Nenhuma certidão extraída ainda.</p>
            <p className="text-xs mt-1">
              Clique em &ldquo;Extrair certidões&rdquo; para disparar via
              Infosimples.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {groups.map(([key, group]) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-sm">{group.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {group.rows.map((row) => {
                const resultData = row.resultData as
                  | { situacao?: string; validade?: string; emissao?: string }
                  | null;
                const validade = formatDateBR(resultData?.validade);
                const stuck = isStuck(row);
                const canRetry =
                  row.status === "failed" ||
                  stuck ||
                  row.status === "awaiting_portal" ||
                  (row.status === "success" && !row.attachmentId);
                const canDelete =
                  row.status === "failed" ||
                  row.status === "success" ||
                  row.status === "skipped";
                const isComplementing = complementJobId === row.id;
                const skippedPayload =
                  row.status === "skipped"
                    ? (row.requestPayload as
                        | {
                            missingFields?: Array<{
                              path: string;
                              label: string;
                              type: string;
                              placeholder?: string;
                            }>;
                            externalLink?: string;
                          }
                        | null)
                    : null;
                const missingFields = skippedPayload?.missingFields ?? [];
                // G.3 — externalLink para portais que não têm cobertura Infosimples
                // (E-Proc SP, IPTU POA, etc). Renderiza botão abrindo nova aba.
                const externalLink = skippedPayload?.externalLink ?? null;
                return (
                  <div key={row.id} className="space-y-2">
                    <div
                      className={cn(
                        "rounded border p-2.5 flex items-start gap-2.5 text-sm cursor-pointer hover:shadow-sm transition-shadow",
                        statusVariant(row)
                      )}
                      onClick={(e) => {
                        // Avoid opening detail when clicking action buttons
                        const target = e.target as HTMLElement;
                        if (target.closest("button") || target.closest("a"))
                          return;
                        setDetailJob(row);
                      }}
                    >
                      <div className="shrink-0 mt-0.5">{statusIcon(row)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{row.label}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span>{statusLabel(row)}</span>
                          {stuck && (
                            <span className="text-amber-700">(travada)</span>
                          )}
                          {(() => {
                            const cat = getFailureCategory(row);
                            if (!cat || cat === "genuine_no_data") return null;
                            return (
                              <Badge variant="outline" className="h-4 text-[10px] px-1 font-normal">
                                {CATEGORY_LABEL[cat]}
                              </Badge>
                            );
                          })()}
                        </div>
                        {(row.costCents != null ||
                          row.latencyMs != null ||
                          validade ||
                          row.retryCount > 0) && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                            {row.costCents != null && row.costCents > 0 && (
                              <span>
                                R$ {(row.costCents / 100).toFixed(2).replace(".", ",")}
                              </span>
                            )}
                            {row.latencyMs != null && row.latencyMs > 0 && (
                              <span>{Math.round(row.latencyMs / 1000)}s</span>
                            )}
                            {validade && (
                              <span className="text-green-700">
                                Válida até {validade}
                              </span>
                            )}
                            {row.retryCount > 0 && (
                              <span>Retries: {row.retryCount}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetailJob(row)}
                          className="h-7 px-2"
                          title="Ver detalhes"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        {row.attachmentId && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              asChild
                              className="h-7 px-2"
                              title="Abrir PDF"
                            >
                              <a
                                href={`/api/deals/${dealId}/attachments/${row.attachmentId}/file`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              asChild
                              className="h-7 px-2"
                              title="Baixar PDF"
                            >
                              <a
                                href={`/api/deals/${dealId}/attachments/${row.attachmentId}/file?download=1`}
                              >
                                <Download className="h-3 w-3" />
                              </a>
                            </Button>
                          </>
                        )}
                        {row.status === "skipped" && missingFields.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setComplementJobId(isComplementing ? null : row.id)
                            }
                            className="h-7 px-2"
                            title="Complementar dados"
                          >
                            <FileText className="h-3 w-3" />
                          </Button>
                        )}
                        {/* G.3 — botão "Abrir portal" para skipped com externalLink */}
                        {row.status === "skipped" && externalLink && (
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            className="h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            title={`Abrir portal oficial: ${externalLink}`}
                          >
                            <a
                              href={externalLink}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        )}
                        {(() => {
                          const cat = getFailureCategory(row);
                          if (!cat || !isUserFixable(cat)) return null;
                          if (row.targetKind === "imovel" || row.targetKind === "diligenciado") return null;
                          return (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingPartyJob(row)}
                              className="h-7 px-2"
                              title="Editar dados da parte e reenviar"
                            >
                              <AlertTriangle className="h-3 w-3" />
                            </Button>
                          );
                        })()}
                        {canRetry && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRetry(row)}
                            className="h-7 px-2"
                            title={
                              row.status === "awaiting_portal"
                                ? "Buscar agora no portal"
                                : row.status === "success"
                                ? "Re-baixar comprovante"
                                : "Tentar novamente"
                            }
                          >
                            {row.status === "awaiting_portal" ? (
                              <CalendarClock className="h-3 w-3" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(row)}
                            disabled={deletingId === row.id}
                            className="h-7 px-2 text-destructive hover:bg-destructive/10"
                            title="Remover"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {isComplementing && missingFields.length > 0 && (
                      <ComplementDadosForm
                        missingFields={missingFields}
                        onCancel={() => setComplementJobId(null)}
                        onSubmit={async (fields) => {
                          const result = await completeSkipped(row.id, fields);
                          if (!result.ok) {
                            toast.error(result.error || "Erro ao complementar");
                            return;
                          }
                          toast.success("Dados complementados — consultando…");
                          setComplementJobId(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <ExtractCertidoesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        dealId={dealId}
        onConfirm={handleExtract}
      />

      {detailJob && (
        <CertidaoDetailDialog
          job={detailJob}
          dealId={dealId}
          open={!!detailJob}
          onOpenChange={(open) => !open && setDetailJob(null)}
          onRetry={() => handleRetry(detailJob)}
          onDelete={() => handleDelete(detailJob)}
        />
      )}

      {editingPartyJob && (
        <EditPartyDialog
          job={editingPartyJob}
          dealId={dealId}
          open={!!editingPartyJob}
          onOpenChange={(open) => !open && setEditingPartyJob(null)}
          onSaved={async () => {
            // After the party data is updated, retry the failing job so it
            // consumes the fresh snapshot from the re-planner.
            const job = editingPartyJob;
            setEditingPartyJob(null);
            if (job) {
              await handleRetry(job);
              toast.success("Dados atualizados — consultando novamente…");
            }
          }}
        />
      )}

      <ShareCertidoesDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        dealId={dealId}
      />
    </div>
  );
}
