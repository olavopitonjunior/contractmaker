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
import { VinculosExpandDialog } from "./VinculosExpandDialog";

interface Props {
  job: CertidaoJobRow;
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onDelete: () => void;
  /** Base do proxy de anexos (`…/attachments`). Default: a do negócio. */
  attachmentsBase?: string;
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
    // Serasa — léxico próprio (sem/com restrição). Mantemos separado pra
    // não confundir com a inversão "positiva = ruim" do léxico Infosimples.
    sem_restricao: {
      label: "Sem restrição",
      className: "bg-green-100 text-green-800 border-green-300",
    },
    com_restricao: {
      label: "Com restrição",
      className: "bg-red-100 text-red-800 border-red-300",
    },
    informativa: {
      label: "Informativo",
      className: "bg-slate-100 text-slate-800 border-slate-300",
    },
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

/**
 * Gauge SVG inline pra score Serasa. 0-1000, cores baseadas em faixa de risco.
 * CSS-only, sem chart lib — mesmo pattern do dashboard de AI usage.
 */
function SerasaScoreGauge({ score, faixa }: { score: number; faixa: string }) {
  const pct = Math.max(0, Math.min(1, score / 1000));
  const angle = Math.PI * pct; // 0..π pra arco superior
  const r = 70;
  const cx = 90;
  const cy = 90;
  const x = cx - r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  const color =
    score >= 700 ? "#16a34a" : score >= 500 ? "#d97706" : score >= 300 ? "#dc2626" : "#991b1b";
  return (
    <div className="flex items-center gap-4">
      <svg width="180" height="110" viewBox="0 0 180 110">
        {/* fundo do arco */}
        <path
          d={`M 20 90 A 70 70 0 0 1 160 90`}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="12"
        />
        {/* arco preenchido até o score */}
        <path
          d={`M 20 90 A 70 70 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
        />
        <text x="90" y="82" textAnchor="middle" fontSize="28" fontWeight="700" fill={color}>
          {score}
        </text>
        <text x="90" y="100" textAnchor="middle" fontSize="10" fill="#64748b">
          / 1000
        </text>
      </svg>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Risco</div>
        <div className="text-lg font-semibold capitalize">{faixa}</div>
      </div>
    </div>
  );
}

interface SerasaRaw {
  score?: number;
  faixa?: string;
  motivos?: Array<{ codigo?: string; descricao?: string }>;
  totalOcorrencias?: number;
  valorTotal?: number;
  pendencias?: Array<{ origem?: string; tipo?: string; data?: string; valor?: number }>;
  protestos?: Array<{ origem?: string; data?: string; valor?: number }>;
  acoes?: Array<{ tipo?: string; origem?: string; data?: string; valor?: number }>;
  vinculos?: Array<{ cnpj?: string; razaoSocial?: string; papel?: string; percentual?: number }>;
  protocolo?: string;
}

function brl(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function SerasaResultView({ endpoint, raw, detalhes }: { endpoint: string; raw: SerasaRaw; detalhes?: string }) {
  if (endpoint.startsWith("serasa/score-")) {
    return (
      <div className="space-y-3">
        {typeof raw.score === "number" && (
          <SerasaScoreGauge score={raw.score} faixa={raw.faixa ?? ""} />
        )}
        {detalhes && <p className="text-sm text-muted-foreground">{detalhes}</p>}
        {raw.motivos && raw.motivos.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Drivers de risco
            </h4>
            <ul className="text-sm space-y-1">
              {raw.motivos.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground">{m.codigo}</span>
                  <span>{m.descricao}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (endpoint.startsWith("serasa/restritivos-")) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="text-3xl font-bold">{raw.totalOcorrencias ?? 0}</div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">ocorrências</div>
            <div className="text-sm">Total {brl(raw.valorTotal)}</div>
          </div>
        </div>
        {detalhes && <p className="text-sm text-muted-foreground">{detalhes}</p>}
        {(["pendencias", "protestos", "acoes"] as const).map((key) => {
          const list = raw[key] as Array<Record<string, unknown>> | undefined;
          if (!list || list.length === 0) return null;
          const titles = { pendencias: "Pendências", protestos: "Protestos", acoes: "Ações judiciais" };
          return (
            <div key={key}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                {titles[key]}
              </h4>
              <table className="w-full text-sm">
                <tbody>
                  {list.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2">{String(row.origem ?? row.tipo ?? "—")}</td>
                      <td className="py-1 pr-2 text-muted-foreground">{String(row.data ?? "")}</td>
                      <td className="py-1 text-right">{brl(row.valor as number | undefined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }
  if (endpoint.startsWith("serasa/vinculos-")) {
    const vinculos = raw.vinculos ?? [];
    return (
      <div className="space-y-3">
        {detalhes && <p className="text-sm text-muted-foreground">{detalhes}</p>}
        {vinculos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum vínculo localizado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1">CNPJ</th>
                <th className="text-left py-1">Razão Social</th>
                <th className="text-left py-1">Papel</th>
                <th className="text-right py-1">%</th>
              </tr>
            </thead>
            <tbody>
              {vinculos.map((v, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1 pr-2 font-mono text-xs">{v.cnpj}</td>
                  <td className="py-1 pr-2">{v.razaoSocial}</td>
                  <td className="py-1 pr-2 capitalize">{v.papel}</td>
                  <td className="py-1 text-right">{v.percentual ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  return null;
}

export function CertidaoDetailDialog({
  job,
  dealId,
  open,
  onOpenChange,
  onRetry,
  onDelete,
  attachmentsBase,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [vinculosOpen, setVinculosOpen] = useState(false);
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
  const isSerasa = job.endpoint.startsWith("serasa/");
  const serasaRaw = isSerasa
    ? ((result as unknown as { raw?: SerasaRaw } | null)?.raw ?? (result as unknown as SerasaRaw | null))
    : null;
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
            {isSerasa && (
              <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300">
                Serasa Experian
              </Badge>
            )}
            {job.retryCount > 0 && (
              <Badge variant="secondary">
                Retries: {job.retryCount}
              </Badge>
            )}
            {job.resultCode != null && (
              <Badge variant="outline">Código {job.resultCode}</Badge>
            )}
          </div>

          {isSerasa && serasaRaw && (
            <div className="rounded border p-4 bg-white">
              <SerasaResultView
                endpoint={job.endpoint}
                raw={serasaRaw}
                detalhes={result?.detalhes}
              />
              {job.endpoint === "serasa/vinculos-pj-pf" &&
                (serasaRaw.vinculos?.length ?? 0) > 0 && (
                  <div className="mt-3 pt-3 border-t flex justify-end">
                    <Button size="sm" onClick={() => setVinculosOpen(true)}>
                      Adicionar como diligenciados
                    </Button>
                  </div>
                )}
            </div>
          )}

          {isSerasa && job.endpoint === "serasa/vinculos-pj-pf" && serasaRaw && (
            <VinculosExpandDialog
              open={vinculosOpen}
              onOpenChange={setVinculosOpen}
              dealId={dealId}
              vinculos={serasaRaw.vinculos ?? []}
            />
          )}

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
                src={`${attachmentsBase ?? `/api/deals/${dealId}/attachments`}/${job.attachmentId}/file`}
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
                  href={`${attachmentsBase ?? `/api/deals/${dealId}/attachments`}/${job.attachmentId}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Nova aba
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`${attachmentsBase ?? `/api/deals/${dealId}/attachments`}/${job.attachmentId}/file?download=1`}
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
