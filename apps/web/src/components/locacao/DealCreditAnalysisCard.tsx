"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BadgeCheck, ExternalLink, Gauge } from "lucide-react";
import { CreditRequestList, creditRequestsPending, type CreditRequestRow } from "@/components/credit/CreditRequestList";

interface State {
  configured: boolean;
  consent: unknown;
  originProposalId: string | null;
  requests: CreditRequestRow[];
}

interface Props {
  dealId: string;
  stageName: string | null;
  /** Proposta de origem (chip "Origem: proposta") — o re-disparo é feito lá. */
  originProposalId: string | null;
  /** LEASE_CREATE — a rota `aprovar-ficha` exige; sem ela o botão não aparece. */
  canApprove: boolean;
}

/**
 * Análise de crédito (Ficha Certa) NO NEGÓCIO de locação — o que veio da
 * proposta convertida (requests/jobs relinkados, laudo em Documentos). Só
 * leitura + "Aprovar ficha" no stage "Em Aprovação" (move para "Formulário");
 * reprovar é o "Marcar como perdido" do header. Re-disparo pelo negócio está
 * fora do MVP: o card leva à proposta de origem.
 */
export function DealCreditAnalysisCard({ dealId, stageName, originProposalId, canApprove }: Props) {
  const router = useRouter();
  const base = `/api/deals/${dealId}/credit-analysis`;
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const inAprovacao = stageName === "Em Aprovação";

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

  async function aprovarFicha() {
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/deals/${dealId}/aprovar-ficha`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(d.error || "Falha ao aprovar a ficha");
        return;
      }
      toast.success('Ficha aprovada — negócio movido para "Formulário"');
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(false);
    }
  }

  const origin = state?.originProposalId ?? originProposalId;

  return (
    <Card className={inAprovacao ? "border-indigo-300" : undefined}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" /> Análise de crédito (Ficha Certa)
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {origin && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/pipeline/propostas/${origin}`}>
                <ExternalLink className="mr-1.5 h-4 w-4" /> Analisar na proposta
              </Link>
            </Button>
          )}
          {inAprovacao && canApprove && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={aprovarFicha} disabled={busy}>
              <BadgeCheck className="mr-1.5 h-4 w-4" />
              {busy ? "Aprovando…" : "Aprovar ficha"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {state && state.requests.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {origin
              ? "Nenhuma análise de crédito veio da proposta. O disparo é feito na proposta de origem."
              : "Nenhuma análise de crédito neste negócio. A análise Ficha Certa é disparada a partir de uma proposta de locação."}
          </p>
        )}
        {state && state.requests.length > 0 && (
          <CreditRequestList requests={state.requests} attachmentFileBase={`/api/deals/${dealId}/attachments`} />
        )}
        {inAprovacao && canApprove && (
          <p className="pt-1 text-xs text-muted-foreground">
            Reprovou a ficha? Use &quot;Marcar como perdido&quot; no topo (causa &quot;Crédito reprovado&quot;).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
