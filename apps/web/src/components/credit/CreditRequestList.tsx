"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

/** Shape que `GET .../credit/analysis` (proposta) e `GET .../credit-analysis` (negócio) devolvem. */
export interface CreditJobRow {
  id: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  status: string;
  situacao: string | null;
  detalhes: string | null;
  scoreFc: number | null;
  parecer: string | null;
  recomendacoes: string[];
  errorMessage: string | null;
  expectedReadyAt: string | null;
}
export interface CreditRequestRow {
  id: string;
  status: string;
  externalId: string | null;
  createdAt: string;
  completedAt: string | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  costCents: number | null;
  reportAttachmentId: string | null;
  parecer: {
    locacao?: { parecer_inquilinos?: { parecer?: string }; parecer_fiadores?: { parecer?: string }; risco?: string };
  } | null;
  jobs: CreditJobRow[];
}

/** Estados em voo — inclui `api_error` (retry automático do motor). */
export const CREDIT_PENDING = new Set(["pending", "fetching", "submitting", "awaiting_portal", "api_error"]);

export function creditRequestsPending(requests: CreditRequestRow[]): boolean {
  return requests.some(
    (r) => r.jobs.some((j) => CREDIT_PENDING.has(j.status)) || r.status === "submitting" || r.status === "pending"
  );
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
export function brlCents(c: number | null): string {
  return c == null ? "" : `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

export function creditSituacaoBadge(j: CreditJobRow) {
  if (CREDIT_PENDING.has(j.status)) {
    return <Badge variant="outline">{j.status === "api_error" ? "Tentando de novo…" : "Analisando…"}</Badge>;
  }
  if (j.status !== "success") return <Badge variant="destructive">{j.status === "failed_permanent" ? "Falhou" : j.status}</Badge>;
  switch (j.situacao) {
    case "sem_restricao":
      return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Sem restrição</Badge>;
    case "com_restricao":
      return <Badge variant="destructive">Com restrição</Badge>;
    default:
      return <Badge variant="secondary">Informativa</Badge>;
  }
}

function requestStatusBadge(status: string) {
  return (
    <Badge variant={status === "completed" ? "default" : status === "failed" ? "destructive" : "outline"}>
      {status === "completed" ? "Concluída" : status === "failed" ? "Falhou" : status === "processing" ? "Em análise" : status}
    </Badge>
  );
}

interface Props {
  requests: CreditRequestRow[];
  /** Base da rota de arquivo do sujeito: `/api/proposals/:id/attachments` ou `/api/deals/:id/attachments`. */
  attachmentFileBase: string;
  /** Ações à direita de cada request (Atualizar/Reenviar…); recebe a request. */
  actions?: (r: CreditRequestRow) => ReactNode;
}

/**
 * Lista de análises de crédito (Ficha Certa) — a MESMA na proposta e no
 * negócio: por request, cabeçalho (data, status, solicitação, custo, PDF) +
 * uma linha por pretendente (badge de situação, Score FC, parecer,
 * recomendações) + parecer da locação (inquilinos/fiadores/risco).
 */
export function CreditRequestList({ requests, attachmentFileBase, actions }: Props) {
  return (
    <>
      {requests.map((r) => (
        <div key={r.id} className="space-y-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</span>
              {requestStatusBadge(r.status)}
              {r.externalId && <span className="text-xs text-muted-foreground">solicitação {r.externalId}</span>}
              {r.costCents != null && r.costCents > 0 && <span className="text-xs text-muted-foreground">{brlCents(r.costCents)}</span>}
            </div>
            <div className="flex items-center gap-1">
              {r.reportAttachmentId && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={`${attachmentFileBase}/${r.reportAttachmentId}/file`} target="_blank" rel="noreferrer">
                    <FileText className="mr-1 h-3.5 w-3.5" /> Laudo (PDF)
                  </a>
                </Button>
              )}
              {actions?.(r)}
            </div>
          </div>
          {r.errorMessage && <p className="text-xs text-destructive">{r.errorMessage}</p>}
          <ul className="space-y-1">
            {r.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-start justify-between gap-2 border-t pt-1">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{j.label.replace(/^Análise de crédito \(Ficha Certa\) — /, "")}</span>
                    {j.scoreFc != null && <Badge variant="outline">Score FC {j.scoreFc}</Badge>}
                  </div>
                  {(j.parecer || j.detalhes) && <p className="text-xs text-muted-foreground">{j.parecer ?? j.detalhes}</p>}
                  {j.recomendacoes.length > 0 && (
                    <p className="text-xs text-muted-foreground">Recomendações: {j.recomendacoes.join("; ")}</p>
                  )}
                  {j.errorMessage && j.status !== "success" && <p className="text-xs text-destructive">{j.errorMessage}</p>}
                </div>
                {creditSituacaoBadge(j)}
              </li>
            ))}
          </ul>
          {r.parecer?.locacao && (r.parecer.locacao.parecer_inquilinos?.parecer || r.parecer.locacao.parecer_fiadores?.parecer) && (
            <div className="rounded bg-muted/40 p-2 text-xs">
              <p className="font-medium">Parecer da locação</p>
              {r.parecer.locacao.parecer_inquilinos?.parecer && <p>Inquilinos: {r.parecer.locacao.parecer_inquilinos.parecer}</p>}
              {r.parecer.locacao.parecer_fiadores?.parecer && <p>Fiadores: {r.parecer.locacao.parecer_fiadores.parecer}</p>}
              {r.parecer.locacao.risco && <p>Risco: {r.parecer.locacao.risco}</p>}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
