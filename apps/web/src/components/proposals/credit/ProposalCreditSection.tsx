"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gauge, RefreshCw, ShieldAlert } from "lucide-react";
import {
  CreditRequestList,
  brlCents,
  creditRequestsPending,
  type CreditRequestRow,
} from "@/components/credit/CreditRequestList";

interface State {
  configured: boolean;
  consent: unknown;
  costCents: number | null;
  requests: CreditRequestRow[];
}

interface Props {
  proposalId: string;
  canEdit: boolean;
  /** Pretendentes com dados faltando (bloqueiam o disparo). */
  incompletos: number;
  pretendentesCount: number;
  hasConsent: boolean;
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

  const hasPending = !!state && creditRequestsPending(state.requests);
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
          Custo estimado: {brlCents(state.costCents)} por pretendente ({pretendentesCount}).
        </p>
      )}

      {state?.requests.length === 0 && !blockedReason && (
        <p className="text-sm text-muted-foreground">Nenhuma análise disparada ainda.</p>
      )}

      {state && (
        <CreditRequestList
          requests={state.requests}
          attachmentFileBase={`/api/proposals/${proposalId}/attachments`}
          actions={(r) =>
            canEdit && r.status !== "failed" && r.status !== "submitting" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => sync(r.id)}
                disabled={!!busy}
                title={r.status === "pending" ? "Reenvia agora à Ficha Certa" : "Consulta o laudo na Ficha Certa agora"}
              >
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy === r.id ? "animate-spin" : ""}`} />{" "}
                {r.status === "pending" ? "Reenviar" : "Atualizar"}
              </Button>
            ) : null
          }
        />
      )}
    </Card>
  );
}
