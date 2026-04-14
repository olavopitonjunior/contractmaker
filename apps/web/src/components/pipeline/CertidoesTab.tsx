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
} from "lucide-react";
import { useCertidoesBatch, type CertidaoJobRow } from "@/hooks/useCertidoesBatch";
import { ExtractCertidoesDialog } from "./ExtractCertidoesDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CertidoesTabProps {
  dealId: string;
  vendedores: Array<{ nome?: string; razao_social?: string }>;
  compradores: Array<{ nome?: string; razao_social?: string }>;
  imoveis: Array<{ rua?: string; cidade?: string }>;
}

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
  }
}

function statusLabel(row: CertidaoJobRow): string {
  const r = row.resultData as { situacao?: string; detalhes?: string } | null;
  if (row.status === "failed") return row.errorMessage || "Erro";
  if (row.status === "pending") return "Na fila…";
  if (row.status === "fetching") return "Consultando…";
  if (row.status === "awaiting_portal") return "Aguardando portal (até 8 dias)";
  if (row.status === "skipped") return "Pulado";
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

export function CertidoesTab({
  dealId,
  vendedores,
  compradores,
  imoveis,
}: CertidoesTabProps) {
  const { jobs, loading, error, extract, retry, refresh } = useCertidoesBatch(dealId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

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
    for (const job of jobs) {
      const key = groupKey(job);
      if (!map.has(key)) {
        map.set(key, { label: `${job.targetKind} ${job.targetIndex + 1}`, rows: [] });
      }
      map.get(key)!.rows.push(job);
    }
    return Array.from(map.entries()).filter(([, g]) => g.rows.length > 0);
  }, [jobs, vendedores, compradores, imoveis]);

  const stats = useMemo(() => {
    const total = jobs.length;
    const success = jobs.filter((j) => j.status === "success").length;
    const failed = jobs.filter((j) => j.status === "failed").length;
    const awaiting = jobs.filter((j) => j.status === "awaiting_portal").length;
    const cost = jobs.reduce((a, j) => a + (j.costCents ?? 0), 0);
    const latencies = jobs
      .map((j) => j.latencyMs)
      .filter((n): n is number => typeof n === "number");
    const avgLatency =
      latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000) : 0;
    return { total, success, failed, awaiting, cost, avgLatency };
  }, [jobs]);

  const handleExtract = async () => {
    const result = await extract();
    if (result) {
      toast.success(`Iniciando ${result.jobCount} certidões…`);
    }
  };

  const handleReport = async () => {
    setGeneratingReport(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/certidoes/report`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Falha ao gerar relatório");
        return;
      }
      toast.success("Relatório gerado");
      window.open(data.fileUrl, "_blank");
    } finally {
      setGeneratingReport(false);
    }
  };

  const hasJobs = jobs.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDialogOpen(true)}>
          <Sparkles className="h-4 w-4 mr-1" />
          {hasJobs ? "Extrair novamente" : "Extrair certidões"}
        </Button>
        {hasJobs && (
          <Button variant="outline" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Atualizar
          </Button>
        )}
        {stats.success > 0 && (
          <Button variant="outline" onClick={handleReport} disabled={generatingReport}>
            <FileText className="h-4 w-4 mr-1" />
            {generatingReport ? "Gerando…" : "Gerar relatório"}
          </Button>
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
            {stats.awaiting > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-amber-600" />
                <strong>{stats.awaiting}</strong> aguardando portal
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Wallet className="h-4 w-4" />R$ {(stats.cost / 100).toFixed(2).replace(".", ",")}
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
              Clique em “Extrair certidões” para disparar via Infosimples.
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
              {group.rows.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "rounded border p-2.5 flex items-start gap-2.5 text-sm",
                    statusVariant(row)
                  )}
                >
                  <div className="shrink-0 mt-0.5">{statusIcon(row.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{row.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {statusLabel(row)}
                    </div>
                    {row.costCents != null && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2">
                        <span>R$ {(row.costCents / 100).toFixed(2).replace(".", ",")}</span>
                        {row.latencyMs != null && (
                          <span>{Math.round(row.latencyMs / 1000)}s</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {row.attachmentId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        asChild
                        className="h-7 px-2"
                      >
                        <a
                          href={`/api/deals/${dealId}/attachments/${row.attachmentId}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    )}
                    {row.status === "failed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => retry(row.id)}
                        className="h-7 px-2"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
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
    </div>
  );
}
