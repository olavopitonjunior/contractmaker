"use client";

// Sem caller desde 2026-09-02, de propósito: o Serasa não está integrado
// (custo provisório, sem teto) e a decisão foi tirar qualquer menção das telas
// de locação até a integração existir. Mantido para religar na ficha do
// cliente quando isso acontecer — não é código morto por esquecimento.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Gauge, ShieldAlert, ShieldCheck } from "lucide-react";

export interface ClientSerasaJob {
  id: string;
  label: string;
  status: string;
  situacao: string | null;
  detalhes: string | null;
  /** id do LeaseClientAttachment (PDF), quando gerado. */
  attachmentId: string | null;
}

const PENDING = new Set([
  "pending",
  "fetching",
  "queued",
  "api_error",
  "rate_limited",
  "portal_unavailable",
]);
const RETRYING = new Set(["api_error", "rate_limited", "portal_unavailable"]);

function situacaoBadge(situacao: string | null, status: string) {
  if (RETRYING.has(status)) return <Badge variant="outline">Tentando de novo…</Badge>;
  if (PENDING.has(status)) return <Badge variant="outline">Consultando…</Badge>;
  if (status !== "success") return <Badge variant="destructive">{status}</Badge>;
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

export function ClientCreditAnalysisCard({
  clientId,
  hasConsent,
  jobs,
  serasaAvailable = true,
}: {
  clientId: string;
  hasConsent: boolean;
  jobs: ClientSerasaJob[];
  /** false quando SERASA_* não está configurado — some com o CTA e evita o 503. */
  serasaAvailable?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const hasPending = jobs.some((j) => PENDING.has(j.status));

  // Enquanto há consultas em voo, recarrega o server component a cada 5s.
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [hasPending, router]);

  async function registerConsent() {
    setBusy("consent");
    try {
      const res = await fetch(`/api/locacao/clients/${clientId}/serasa-consent`, {
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
      const res = await fetch(`/api/locacao/clients/${clientId}/credit-analysis`, {
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

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Análise de crédito (Serasa)
        </CardTitle>
        {!serasaAvailable ? (
          <Badge variant="outline" className="text-muted-foreground">
            Indisponível
          </Badge>
        ) : !hasConsent ? (
          <Button size="sm" variant="outline" onClick={registerConsent} disabled={busy !== null}>
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            {busy === "consent" ? "Registrando…" : "Registrar consentimento LGPD"}
          </Button>
        ) : (
          <Button size="sm" onClick={runAnalysis} disabled={busy !== null || hasPending}>
            <ShieldAlert className="h-4 w-4 mr-1.5" />
            {busy === "analyze" ? "Disparando…" : jobs.length > 0 ? "Reanalisar crédito" : "Analisar crédito"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {!serasaAvailable ? (
          jobs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              A consulta Serasa não está habilitada nesta conta. A análise de crédito fica por conta
              das certidões e da fiança por seguradora.
            </p>
          )
        ) : (
          <>
        {!hasConsent && (
          <p className="text-xs text-muted-foreground">
            A consulta Serasa exige consentimento LGPD do titular (base legal: proteção ao crédito).
            Custo ~R$ 5,00 por consulta (score + negativação por pessoa).
          </p>
        )}
        {jobs.length === 0 && hasConsent && (
          <p className="text-sm text-muted-foreground">
            Nenhuma consulta ainda. Preencha o CPF/CNPJ do cliente e clique em Analisar crédito.
          </p>
        )}
          </>
        )}
        {jobs.length > 0 && (
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
                      href={`/api/locacao/clients/${clientId}/attachments/${j.attachmentId}/file`}
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
      </CardContent>
    </Card>
  );
}
