"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldCheck, Sparkles, ExternalLink, FileText, Edit3 } from "lucide-react";
import { AditamentoDialog } from "./AditamentoDialog";

/**
 * F4.7 — Painel de Análise IA das Certidões.
 *
 * Mostra findings de `crossCheckCertidoes` (matrícula com ônus, fiscais
 * positivas, IPTU, protesto, etc) com botão "Aplicar Aditamento" que
 * abre o contrato em modo chat com prompt sintético.
 *
 * Como funciona:
 *   1. Carrega findings via GET /api/deals/[dealId]/certidoes/analysis.
 *   2. Pra cada finding com `suggested_aditamento`, renderiza card.
 *   3. Botão "Aplicar Aditamento" navega pra /contracts/[contractId]?msg=...
 *      — o chat pré-preenche o input com prompt referenciando o finding.
 *      Editor (graph) então chama cross_check_certidoes + propose_suggestion
 *      em 1 turn (F4.x polish).
 *
 * Não substitui a aba Certidões — complementa. Aparece acima da lista de jobs.
 */

interface Finding {
  kind: string;
  severity: "error" | "warning" | "info";
  message: string;
  target?: string;
  endpoint?: string;
  suggested_aditamento?: string;
  /** F4 iteração 2026-05-17 — caminhos de clarificação quando finding ambíguo. */
  clarification_paths?: string[];
  manual_action?: { label: string; url?: string };
  jobId?: string;
}

interface AnalysisResponse {
  dealId: string;
  contractId: string | null;
  jobs: { total: number; success: number; failed: number; pending: number };
  findings: Finding[];
  summary: {
    total: number;
    bySeverity: { error: number; warning: number; info: number };
    hasBlockingIssues: boolean;
  };
  /** F4 iteração 2026-05-17 — backend devolve estado de assinatura pra UI
   *  decidir entre "Aplicar no contrato" (draft) e "Criar aditamento" (signed). */
  signingState?: {
    hasSignedContract: boolean;
    signedAt: string | null;
    originalContractId: string | null;
  };
  message?: string;
}

interface Props {
  dealId: string;
}

const SEVERITY_STYLE: Record<Finding["severity"], { ring: string; badge: string; icon: string }> = {
  error: {
    ring: "ring-red-300 bg-red-50",
    badge: "bg-red-100 text-red-800 border-red-300",
    icon: "text-red-600",
  },
  warning: {
    ring: "ring-amber-300 bg-amber-50",
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    icon: "text-amber-600",
  },
  info: {
    ring: "ring-blue-300 bg-blue-50",
    badge: "bg-blue-100 text-blue-800 border-blue-300",
    icon: "text-blue-600",
  },
};

export function CertidoesAnalysisPanel({ dealId }: Props) {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [openFinding, setOpenFinding] = useState<Finding | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/deals/${dealId}/certidoes/analysis`);
        if (!res.ok) {
          setData(null);
          return;
        }
        const json = (await res.json()) as AnalysisResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        console.error("[CertidoesAnalysisPanel] load falhou:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Carregando análise de IA…
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  if (!data.contractId) {
    return (
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-3 text-sm text-blue-900 flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {data.message ?? "Análise IA ficará disponível após geração do contrato."}
        </CardContent>
      </Card>
    );
  }

  if (data.findings.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50">
        <CardContent className="py-3 text-sm text-emerald-900 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          ✅ Certidões emitidas estão limpas — sem divergências detectadas no
          contrato.
          <span className="ml-auto text-xs text-emerald-700">
            {data.jobs.success}/{data.jobs.total} jobs ok
          </span>
        </CardContent>
      </Card>
    );
  }

  const errors = data.summary.bySeverity.error;
  const warnings = data.summary.bySeverity.warning;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" />
          Análise IA das Certidões
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {data.summary.total} achado{data.summary.total !== 1 ? "s" : ""}
            {errors > 0 && (
              <>
                {" · "}
                <span className="text-red-700 font-medium">{errors} bloqueante{errors !== 1 ? "s" : ""}</span>
              </>
            )}
            {warnings > 0 && (
              <>
                {" · "}
                <span className="text-amber-700 font-medium">{warnings} aviso{warnings !== 1 ? "s" : ""}</span>
              </>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.findings.map((f, idx) => {
          const style = SEVERITY_STYLE[f.severity];
          return (
            <div
              key={`${f.kind}-${idx}`}
              className={`rounded-lg ring-1 ${style.ring} px-3 py-2.5 text-sm`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${style.icon}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <span className={`inline-block text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${style.badge}`}>
                      {f.severity}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {f.kind}
                    </span>
                    {f.target && (
                      <span className="text-xs text-muted-foreground truncate">
                        {f.target}
                      </span>
                    )}
                  </div>
                  <div className="text-foreground/90 mb-2">{f.message}</div>
                  <div className="flex flex-wrap gap-2 items-center">
                    {(f.suggested_aditamento || f.clarification_paths) && data.contractId && (
                      <Button
                        size="sm"
                        variant={f.severity === "error" ? "default" : "outline"}
                        onClick={() => setOpenFinding(f)}
                        className="h-7 text-xs"
                      >
                        {data.signingState?.hasSignedContract ? (
                          <>
                            <FileText className="h-3 w-3 mr-1" />
                            Tratar achado · aditamento
                          </>
                        ) : (
                          <>
                            <Edit3 className="h-3 w-3 mr-1" />
                            Tratar achado · contrato
                          </>
                        )}
                      </Button>
                    )}
                    {f.manual_action?.url && (
                      <a
                        href={f.manual_action.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                      >
                        {f.manual_action.label}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {f.jobId && (
                      <span className="font-mono text-[10px] text-muted-foreground ml-auto">
                        job {f.jobId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>

      {openFinding && data?.contractId && (
        <AditamentoDialog
          open={!!openFinding}
          onOpenChange={(o) => { if (!o) setOpenFinding(null); }}
          dealId={data.dealId}
          contractId={data.contractId}
          signingState={data.signingState ?? null}
          finding={openFinding}
        />
      )}
    </Card>
  );
}
