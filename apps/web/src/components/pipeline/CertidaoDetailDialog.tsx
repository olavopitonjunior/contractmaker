"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ExternalLink,
  Download,
  RefreshCw,
  Trash2,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import type { CertidaoJobRow } from "@/hooks/useCertidoesBatch";
import { useState } from "react";

interface Props {
  job: CertidaoJobRow;
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onDelete: () => void;
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

function situacaoBadge(situacao: string | undefined) {
  if (!situacao) return null;
  const map: Record<string, { label: string; className: string }> = {
    negativa: { label: "Negativa (nada consta)", className: "bg-green-100 text-green-800 border-green-300" },
    positiva: { label: "Positiva (consta débito)", className: "bg-red-100 text-red-800 border-red-300" },
    positiva_com_efeitos: {
      label: "Positiva com efeitos de negativa",
      className: "bg-amber-100 text-amber-800 border-amber-300",
    },
    nao_emitida: { label: "Não emitida", className: "bg-gray-100 text-gray-800 border-gray-300" },
    indeterminado: { label: "Indeterminado", className: "bg-gray-100 text-gray-800" },
  };
  const cfg = map[situacao] ?? {
    label: situacao,
    className: "bg-gray-100 text-gray-800",
  };
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}

export function CertidaoDetailDialog({
  job,
  dealId,
  open,
  onOpenChange,
  onRetry,
  onDelete,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const result = job.resultData as
    | {
        situacao?: string;
        validade?: string;
        emissao?: string;
        detalhes?: string;
        consta_debito?: boolean;
        _rawReceipt?: string;
      }
    | null;
  const validade = formatDateBR(result?.validade);
  const emissao = formatDateBR(result?.emissao);
  const canRetry =
    job.status === "failed" ||
    job.status === "awaiting_portal" ||
    (job.status === "success" && !job.attachmentId);
  const canDelete =
    job.status === "failed" || job.status === "success" || job.status === "skipped";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {job.status === "success" && (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            )}
            {job.status === "failed" && <XCircle className="h-5 w-5 text-red-600" />}
            {job.status === "awaiting_portal" && (
              <Clock className="h-5 w-5 text-amber-600" />
            )}
            {job.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {situacaoBadge(result?.situacao)}
            {job.retryCount > 0 && (
              <Badge variant="secondary">
                Retries: {job.retryCount}
              </Badge>
            )}
            {job.resultCode != null && (
              <Badge variant="outline">Código {job.resultCode}</Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 rounded border p-3 bg-muted/20">
            <div>
              <p className="text-xs text-muted-foreground">Endpoint</p>
              <p className="font-mono text-xs">{job.endpoint}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Criado em</p>
              <p>{new Date(job.createdAt).toLocaleString("pt-BR")}</p>
            </div>
            {emissao && (
              <div>
                <p className="text-xs text-muted-foreground">Emissão</p>
                <p>{emissao}</p>
              </div>
            )}
            {validade && (
              <div>
                <p className="text-xs text-muted-foreground">Validade</p>
                <p className="text-green-700 font-medium">{validade}</p>
              </div>
            )}
            {job.latencyMs != null && (
              <div>
                <p className="text-xs text-muted-foreground">Latência</p>
                <p>{Math.round(job.latencyMs / 1000)}s</p>
              </div>
            )}
            {job.costCents != null && (
              <div>
                <p className="text-xs text-muted-foreground">Custo</p>
                <p>R$ {(job.costCents / 100).toFixed(2).replace(".", ",")}</p>
              </div>
            )}
          </div>

          {result?.detalhes && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Detalhes</p>
              <p className="whitespace-pre-wrap">{result.detalhes}</p>
            </div>
          )}

          {job.errorMessage && (
            <div className="rounded border border-red-300 bg-red-50 p-3">
              <p className="text-xs text-red-600 font-medium mb-1">Erro</p>
              <p className="text-red-800">{job.errorMessage}</p>
            </div>
          )}

          {job.attachmentId && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Documento</p>
              <iframe
                src={`/api/deals/${dealId}/attachments/${job.attachmentId}/file`}
                className="w-full h-[60vh] border rounded"
                title={job.label}
              />
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowRaw(!showRaw)}
              className="text-xs text-muted-foreground hover:underline"
            >
              {showRaw ? "Ocultar" : "Ver"} dados técnicos (JSON)
            </button>
            {showRaw && (
              <pre className="mt-2 text-[10px] bg-muted p-2 rounded overflow-x-auto max-h-48">
                {JSON.stringify(job.resultData, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {job.attachmentId && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/deals/${dealId}/attachments/${job.attachmentId}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Nova aba
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/deals/${dealId}/attachments/${job.attachmentId}/file?download=1`}
                >
                  <Download className="h-3 w-3 mr-1" />
                  Baixar
                </a>
              </Button>
            </>
          )}
          {canRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Tentar novamente
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onDelete();
                onOpenChange(false);
              }}
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Remover
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
