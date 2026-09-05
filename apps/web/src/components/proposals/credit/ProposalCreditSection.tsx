"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Gauge, RefreshCw, ShieldAlert } from "lucide-react";

interface JobView {
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
interface RequestView {
  id: string;
  status: string;
  externalId: string | null;
  createdAt: string;
  completedAt: string | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  costCents: number | null;
  reportAttachmentId: string | null;
  parecer: { locacao?: { parecer_inquilinos?: { parecer?: string }; parecer_fiadores?: { parecer?: string }; risco?: string } } | null;
  jobs: JobView[];
}
interface State {
  configured: boolean;
  consent: unknown;
  costCents: number | null;
  requests: RequestView[];
}

interface Props {
  proposalId: string;
  canEdit: boolean;
  /** Pretendentes com dados faltando (bloqueiam o disparo). */
  incompletos: number;
  pretendentesCount: number;
  hasConsent: boolean;
}

const PENDING = new Set(["pending", "fetching", "submitting", "awaiting_portal", "api_error"]);

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function brl(c: number | null): string {
  return c == null ? "" : `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function situacaoBadge(j: JobView) {
  if (PENDING.has(j.status)) {
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

/**
 * "Análise de crédito (Ficha Certa)" na proposta de locação: dispara para
 * todos os pretendentes prontos, acompanha os laudos (webhook/cron), mostra
 * Score FC, parecer e o parecer da locação (inquilinos/fiadores), PDF do
 * laudo. Consentimento e pendências vivem no editor de partes acima.
 */
export function ProposalCreditSection({ proposalId, canEdit, incompletos, pretendentesCount, hasConsent }: Props) {
  const router = useRouter();
  const base = `/api/proposals/${proposalId}/credit/analysis`;
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (res.ok) setState((await res.json()) as State);
    } catch {
      /* card é conveniência */
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPending = !!state?.requests.some((r) => r.jobs.some((j) => PENDING.has(j.status)) || r.status === "submitting" || r.status === "pending");
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [hasPending, load]);

  async function dispatch() {
    setBusy("dispatch");
    try {
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = (await res.json().catch(() => ({}))) as { error?: string; jobCount?: number };
      if (!res.ok) {
        toast.error(d.error ?? "Falha ao disparar a análise");
        return;
      }
      toast.success(`Análise enviada para ${d.jobCount ?? 0} pretendente(s). O laudo chega em alguns minutos.`);
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sync(requestId: string) {
    setBusy(requestId);
    try {
      const res = await fetch(`${base}/${requestId}/sync`, { method: "POST" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? "Falha ao atualizar");
        return;
      }
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const blockedReason = !state
    ? null
    : !state.configured
      ? "Conta Ficha Certa não conectada (Configurações › Integrações)."
      : !hasConsent
        ? "Registre o consentimento LGPD acima antes de analisar."
        : pretendentesCount === 0
          ? "Informe o locatário na proposta."
          : incompletos > 0
            ? `${incompletos} pretendente(s) com dados faltando — complete acima.`
            : null;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Gauge className="h-4 w-4" /> Análise de crédito (Ficha Certa)
        </h2>
        {canEdit && (
          <Button size="sm" onClick={dispatch} disabled={!!busy || !!blockedReason || hasPending}>
            {hasPending ? "Analisando…" : "Analisar pretendentes"}
          </Button>
        )}
      </div>
      {blockedReason && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4" /> {blockedReason}
        </p>
      )}
      {state?.costCents != null && !blockedReason && !hasPending && (
        <p className="text-xs text-muted-foreground">
          Custo estimado: {brl(state.costCents)} por pretendente ({pretendentesCount}).
        </p>
      )}

      {state?.requests.length === 0 && !blockedReason && (
        <p className="text-sm text-muted-foreground">Nenhuma análise disparada ainda.</p>
      )}

      {state?.requests.map((r) => (
        <div key={r.id} className="space-y-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{fmt(r.createdAt)}</span>
              <Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "outline"}>
                {r.status === "completed" ? "Concluída" : r.status === "failed" ? "Falhou" : r.status === "processing" ? "Em análise" : r.status}
              </Badge>
              {r.externalId && <span className="text-xs text-muted-foreground">solicitação {r.externalId}</span>}
              {r.costCents != null && r.costCents > 0 && <span className="text-xs text-muted-foreground">{brl(r.costCents)}</span>}
            </div>
            <div className="flex items-center gap-1">
              {r.reportAttachmentId && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={`/api/proposals/${proposalId}/attachments/${r.reportAttachmentId}/file`} target="_blank" rel="noreferrer">
                    <FileText className="mr-1 h-3.5 w-3.5" /> Laudo (PDF)
                  </a>
                </Button>
              )}
              {canEdit && r.status !== "failed" && r.status !== "submitting" && (
                <Button variant="ghost" size="sm" onClick={() => sync(r.id)} disabled={!!busy} title={r.status === "pending" ? "Reenvia agora à Ficha Certa" : "Consulta o laudo na Ficha Certa agora"}>
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy === r.id ? "animate-spin" : ""}`} /> {r.status === "pending" ? "Reenviar" : "Atualizar"}
                </Button>
              )}
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
                  {(j.parecer || j.detalhes) && (
                    <p className="text-xs text-muted-foreground">{j.parecer ?? j.detalhes}</p>
                  )}
                  {j.recomendacoes.length > 0 && (
                    <p className="text-xs text-muted-foreground">Recomendações: {j.recomendacoes.join("; ")}</p>
                  )}
                  {j.errorMessage && j.status !== "success" && <p className="text-xs text-destructive">{j.errorMessage}</p>}
                </div>
                {situacaoBadge(j)}
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
    </Card>
  );
}
