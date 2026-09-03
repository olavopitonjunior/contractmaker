"use client";

// Sem caller desde 2026-09-02, de propósito: o Serasa não está integrado
// (custo provisório, sem teto) e a decisão foi tirar qualquer menção das telas
// de locação até a integração existir. Mantido para religar no detalhe do
// negócio quando isso acontecer — não é código morto por esquecimento.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BadgeCheck, FileText, Gauge, ShieldAlert, ShieldCheck } from "lucide-react";

export interface SerasaJobSummary {
  id: string;
  label: string;
  endpoint: string;
  status: string;
  situacao: string | null;
  detalhes: string | null;
  attachmentId: string | null;
  createdAt: string;
}

interface LocacaoCreditAnalysisCardProps {
  dealId: string;
  stageName: string | null;
  hasConsent: boolean;
  /** Jobs Serasa existentes do deal (mais recentes primeiro). */
  jobs: SerasaJobSummary[];
}

// Inclui os transitórios com retry automático do motor de certidões
// (api_error/rate_limited/portal_unavailable): sem eles, um rate-limit virava
// badge vermelho E parava o auto-refresh, deixando o card obsoleto quando o
// cron completasse o job.
const PENDING_STATUSES = new Set([
  "pending",
  "fetching",
  "queued",
  "api_error",
  "rate_limited",
  "portal_unavailable",
]);
const RETRYING_STATUSES = new Set(["api_error", "rate_limited", "portal_unavailable"]);

function situacaoBadge(situacao: string | null, status: string) {
  if (RETRYING_STATUSES.has(status)) {
    return <Badge variant="outline">Tentando de novo…</Badge>;
  }
  if (PENDING_STATUSES.has(status)) {
    return <Badge variant="outline">Consultando…</Badge>;
  }
  if (status !== "success") {
    return <Badge variant="destructive">{status}</Badge>;
  }
  switch (situacao) {
    case "sem_restricao":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400">
          Sem restrição
        </Badge>
      );
    case "com_restricao":
      return <Badge variant="destructive">Com restrição</Badge>;
    default:
      return <Badge variant="secondary">Informativa</Badge>;
  }
}

/**
 * Análise de crédito da ficha (stage "Em Aprovação") — dispara Serasa Score +
 * Restritivos pros locatários/fiador e mostra o resultado. Aprovação move o
 * deal pra "Formulário"; reprovação usa o "Marcar como perdido" do header
 * (categoria "Crédito reprovado").
 */
export function LocacaoCreditAnalysisCard({
  dealId,
  stageName,
  hasConsent,
  jobs,
}: LocacaoCreditAnalysisCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const hasPending = jobs.some((j) => PENDING_STATUSES.has(j.status));
  const inAprovacao = stageName === "Em Aprovação";

  // Enquanto há consultas em voo, recarrega o server component a cada 5s.
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [hasPending, router]);

  async function registerConsent() {
    setBusy("consent");
    try {
      const res = await fetch(`/api/deals/${dealId}/serasa/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseLegal: "protecao_credito" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Falha ao registrar consentimento");
        return;
      }
      toast.success("Consentimento LGPD registrado");
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(null);
    }
  }

  async function runAnalysis() {
    setBusy("analyze");
    try {
      const res = await fetch(`/api/locacao/deals/${dealId}/credit-analysis`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Falha ao disparar a análise");
        return;
      }
      toast.success(
        `Análise disparada — ${d.jobCount} consulta(s), R$ ${(d.totalCostCents / 100).toFixed(2)}`
      );
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(null);
    }
  }

  async function aprovarFicha() {
    setBusy("approve");
    try {
      const res = await fetch(`/api/locacao/deals/${dealId}/aprovar-ficha`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Falha ao aprovar a ficha");
        return;
      }
      toast.success('Ficha aprovada — negócio movido pra "Formulário"');
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={inAprovacao ? "border-indigo-300" : undefined}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Análise de crédito (Serasa)
        </CardTitle>
        <div className="flex gap-2 flex-wrap">
          {!hasConsent ? (
            <Button size="sm" variant="outline" onClick={registerConsent} disabled={busy !== null}>
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              {busy === "consent" ? "Registrando…" : "Registrar consentimento LGPD"}
            </Button>
          ) : (
            <Button size="sm" onClick={runAnalysis} disabled={busy !== null || hasPending}>
              <ShieldAlert className="h-4 w-4 mr-1.5" />
              {busy === "analyze"
                ? "Disparando…"
                : jobs.length > 0
                  ? "Reanalisar crédito"
                  : "Analisar crédito"}
            </Button>
          )}
          {inAprovacao && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={aprovarFicha}
              disabled={busy !== null}
            >
              <BadgeCheck className="h-4 w-4 mr-1.5" />
              {busy === "approve" ? "Aprovando…" : "Aprovar ficha"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!hasConsent && (
          <p className="text-xs text-muted-foreground">
            A consulta Serasa exige consentimento LGPD do titular registrado
            neste negócio (base legal: proteção ao crédito). Custo ~R$ 5,00 por
            consulta (score + negativação por pessoa).
          </p>
        )}
        {jobs.length === 0 ? (
          hasConsent && (
            <p className="text-sm text-muted-foreground">
              Nenhuma consulta ainda. A análise roda score + negativação pra
              cada locatário e pro fiador com CPF/CNPJ preenchido no formulário.
            </p>
          )
        ) : (
          <ul className="divide-y">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm truncate">{j.label}</p>
                  {j.detalhes && (
                    <p className="text-xs text-muted-foreground truncate" title={j.detalhes}>
                      {j.detalhes}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {situacaoBadge(j.situacao, j.status)}
                  {j.attachmentId && (
                    <a
                      href={`/api/deals/${dealId}/attachments/${j.attachmentId}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                      title="Abrir PDF da consulta"
                    >
                      <FileText className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {inAprovacao && (
          <p className="text-xs text-muted-foreground pt-1">
            Reprovou a ficha? Use "Marcar como perdido" no topo (causa "Crédito
            reprovado").
          </p>
        )}
      </CardContent>
    </Card>
  );
}
