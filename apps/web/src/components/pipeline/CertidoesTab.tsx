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
import { useCertidoesBatch, type CertidaoJobRow } from "@/hooks/useCertidoesBatch";
import { ExtractCertidoesDialog } from "./ExtractCertidoesDialog";
import { CertidaoDetailDialog } from "./CertidaoDetailDialog";
import { ComplementDadosForm } from "./ComplementDadosForm";
import { ShareCertidoesDialog } from "./ShareCertidoesDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CertidoesTabProps {
  dealId: string;
  vendedores: Array<{ nome?: string; razao_social?: string }>;
  compradores: Array<{ nome?: string; razao_social?: string }>;
  imoveis: Array<{ rua?: string; cidade?: string }>;
}

const STALE_AFTER_MS = 5 * 60_000;

function statusIcon(status: CertidaoJobRow["status"]) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
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

function statusLabel(row: CertidaoJobRow): string {
  const r = row.resultData as { situacao?: string; detalhes?: string } | null;
  if (row.status === "failed") return row.errorMessage || "Erro";
  if (row.status === "pending") return "Na fila…";
  if (row.status === "fetching") return "Consultando…";
  if (row.status === "awaiting_portal") return "Aguardando portal";
  if (row.status === "skipped") return row.errorMessage || "Pulado — dados faltantes";
  if (row.status === "replaced") return "Substituído";
  if (row.status === "success") {
    switch (r?.situacao) {
      case "negativa":
        return "Negativa · nada consta";
      case "positiva":
        return "Positiva · consta débito";
      case "positiva_com_efeitos":
        return "Positiva com efeitos de negativa";
      case "nao_emitida":
        return "Não emitida pelo portal";
      default:
        return r?.detalhes || "Concluído";
    }
  }
  return "—";
}

function statusVariant(row: CertidaoJobRow): string {
  const r = row.resultData as { situacao?: string } | null;
  if (row.status === "failed") return "border-red-300 bg-red-50";
  if (row.status === "awaiting_portal") return "border-amber-300 bg-amber-50";
  if (row.status === "fetching" || row.status === "pending")
    return "border-blue-300 bg-blue-50/30";
  if (row.status === "skipped") return "border-muted bg-muted/20";
  if (row.status === "replaced") return "border-muted bg-muted/10 opacity-60";
  if (row.status === "success") {
    if (r?.situacao === "negativa") return "border-green-300 bg-green-50/30";
    if (r?.situacao === "positiva" || r?.situacao === "positiva_com_efeitos")
      return "border-amber-300 bg-amber-50";
    return "border-muted bg-background";
  }
  return "border-muted bg-muted/20";
}

function groupKey(row: CertidaoJobRow): string {
  return `${row.targetKind}-${row.targetIndex}`;
}

function isStuck(row: CertidaoJobRow): boolean {
  if (row.status !== "fetching" && row.status !== "pending") return false;
  const started = new Date(row.createdAt).getTime();
  return Date.now() - started > STALE_AFTER_MS;
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

  const visibleJobs = useMemo(
    () => jobs.filter((j) => j.status !== "replaced"),
    [jobs]
  );

  const groups = useMemo(() => {
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
    imoveis.forEach((im, i) =>
      map.set(`imovel-${i}`, {
        label: `Imóvel: ${im.rua || im.cidade || `#${i + 1}`}`,
        rows: [],
      })
    );
    for (const job of visibleJobs) {
      const key = groupKey(job);
      if (!map.has(key)) {
        map.set(key, {
          label: `${job.targetKind} ${job.targetIndex + 1}`,
          rows: [],
        });
      }
      map.get(key)!.rows.push(job);
    }
    return Array.from(map.entries()).filter(([, g]) => g.rows.length > 0);
  }, [visibleJobs, vendedores, compradores, imoveis]);

  const stats = useMemo(() => {
    const total = visibleJobs.length;
    const success = visibleJobs.filter((j) => j.status === "success").length;
    const failed = visibleJobs.filter((j) => j.status === "failed").length;
    const awaiting = visibleJobs.filter((j) => j.status === "awaiting_portal").length;
    const fetching = visibleJobs.filter(
      (j) => j.status === "fetching" || j.status === "pending"
    ).length;
    const skipped = visibleJobs.filter((j) => j.status === "skipped").length;
    const stuck = visibleJobs.filter(isStuck).length;
    const cost = visibleJobs.reduce((a, j) => a + (j.costCents ?? 0), 0);
    const latencies = visibleJobs
      .map((j) => j.latencyMs)
      .filter((n): n is number => typeof n === "number");
    const avgLatency =
      latencies.length > 0
        ? Math.round(
            latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000
          )
        : 0;
    return {
      total,
      success,
      failed,
      awaiting,
      fetching,
      skipped,
      stuck,
      cost,
      avgLatency,
    };
  }, [visibleJobs]);

  const handleExtract = async () => {
    if (extracting) return;
    setExtracting(true);
    try {
      const result = await extract();
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

  const handleSweep = async () => {
    const count = await sweepStale();
    if (count > 0) {
      toast.success(`${count} certidão(ões) travada(s) destravada(s)`);
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
        {stats.stuck > 0 && (
          <Button
            variant="outline"
            onClick={handleSweep}
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <LifeBuoy className="h-4 w-4 mr-1" />
            Recuperar travadas ({stats.stuck})
          </Button>
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
                const missingFields =
                  row.status === "skipped"
                    ? ((row.requestPayload as
                        | { missingFields?: Array<{ path: string; label: string; type: string; placeholder?: string }> }
                        | null)?.missingFields ?? [])
                    : [];
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
                      <div className="shrink-0 mt-0.5">{statusIcon(row.status)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{row.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {statusLabel(row)}
                          {stuck && (
                            <span className="ml-1 text-amber-700">(travada)</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                          {row.costCents != null && (
                            <span>
                              R$ {(row.costCents / 100).toFixed(2).replace(".", ",")}
                            </span>
                          )}
                          {row.latencyMs != null && (
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
                        {row.status === "skipped" && (
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

      <ShareCertidoesDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        dealId={dealId}
      />
    </div>
  );
}
