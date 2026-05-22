"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  Loader2,
} from "lucide-react";

export interface ProblemRow {
  id: string;
  dealId: string | null;
  label: string;
  endpoint: string;
  status: string;
  resultCode: number | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  categoryLabel: string | null;
  portalUrl: string | null;
}

interface AttemptsResponse {
  job: {
    resultData: unknown;
    requestPayload: unknown;
    resultMessage: string | null;
  };
  attempts: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    metadata: unknown;
    createdAt: string;
  }>;
}

interface HealthResponse {
  infosimples?: { ok: boolean; latencyMs?: number; errorMessage?: string };
  govbr?: { active: boolean; identifier?: string; expiresAt?: string };
  onr?: { active: boolean; mode?: string | null; error?: string };
  checkedAt?: string;
}

export function CertidoesMonitorClient({ problems }: { problems: ProblemRow[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, AttemptsResponse>>({});
  const [loadingAttempts, setLoadingAttempts] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  async function toggleRow(jobId: string) {
    if (expanded === jobId) {
      setExpanded(null);
      return;
    }
    setExpanded(jobId);
    if (!attempts[jobId]) {
      setLoadingAttempts(jobId);
      try {
        const res = await fetch(`/api/certidoes/${jobId}/attempts`);
        const data = await res.json();
        if (res.ok) setAttempts((prev) => ({ ...prev, [jobId]: data }));
        else toast.error(data.error || "Falha ao carregar tentativas");
      } catch {
        toast.error("Falha ao carregar tentativas");
      } finally {
        setLoadingAttempts(null);
      }
    }
  }

  async function retry(p: ProblemRow) {
    if (!p.dealId) {
      toast.error("Job sem negócio vinculado");
      return;
    }
    setRetrying(p.id);
    try {
      const res = await fetch(
        `/api/deals/${p.dealId}/certidoes/${p.id}/retry`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Nova tentativa iniciada");
        router.refresh();
      } else {
        toast.error(data.error || "Falha ao reprocessar");
      }
    } catch {
      toast.error("Falha ao reprocessar");
    } finally {
      setRetrying(null);
    }
  }

  async function checkHealth() {
    setCheckingHealth(true);
    try {
      const res = await fetch(`/api/admin/certidoes/health`);
      const data = await res.json();
      if (res.ok) setHealth(data);
      else toast.error(data.error || "Falha no health check");
    } catch {
      toast.error("Falha no health check");
    } finally {
      setCheckingHealth(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Verificação ao vivo da API (sob demanda — gasta ~R$ 0,04) */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="outline" onClick={checkHealth} disabled={checkingHealth}>
          {checkingHealth ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Activity className="h-4 w-4 mr-1" />
          )}
          Verificar API agora
        </Button>
        {health && (
          <div className="text-xs flex items-center gap-3">
            <Badge
              variant="outline"
              className={
                health.infosimples?.ok
                  ? "border-green-500 text-green-700"
                  : "border-red-500 text-red-700"
              }
            >
              Infosimples {health.infosimples?.ok ? "OK" : "indisponível"}
              {health.infosimples?.latencyMs != null
                ? ` · ${Math.round(health.infosimples.latencyMs)}ms`
                : ""}
            </Badge>
            <Badge
              variant="outline"
              className={
                health.govbr?.active
                  ? "border-green-500 text-green-700"
                  : "border-amber-500 text-amber-700"
              }
            >
              GOV.BR {health.govbr?.active ? "ativo" : "inativo"}
            </Badge>
            <Badge
              variant="outline"
              className={
                health.onr?.active
                  ? "border-green-500 text-green-700"
                  : "border-amber-500 text-amber-700"
              }
            >
              ONR {health.onr?.active ? "ativo" : "inativo"}
            </Badge>
            {health.infosimples?.errorMessage && (
              <span className="text-red-700 font-mono">
                {health.infosimples.errorMessage}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Relatório de problemas */}
      {problems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma certidão com problema em aberto. 🎉
        </p>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left p-2 w-6"></th>
                <th className="text-left p-2">Negócio / Parte</th>
                <th className="text-left p-2">Endpoint</th>
                <th className="text-left p-2">Categoria</th>
                <th className="text-right p-2">Tentativas</th>
                <th className="text-left p-2">Erro</th>
                <th className="text-right p-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((p) => (
                <FragmentRow
                  key={p.id}
                  p={p}
                  expanded={expanded === p.id}
                  onToggle={() => toggleRow(p.id)}
                  onRetry={() => retry(p)}
                  retrying={retrying === p.id}
                  loadingAttempts={loadingAttempts === p.id}
                  data={attempts[p.id]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  p,
  expanded,
  onToggle,
  onRetry,
  retrying,
  loadingAttempts,
  data,
}: {
  p: ProblemRow;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
  loadingAttempts: boolean;
  data?: AttemptsResponse;
}) {
  return (
    <>
      <tr className="border-t align-top">
        <td className="p-2">
          <button onClick={onToggle} className="text-muted-foreground" aria-label="expandir">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </td>
        <td className="p-2">
          {p.dealId ? (
            <Link href={`/deals/${p.dealId}`} className="font-medium hover:underline">
              {p.label}
            </Link>
          ) : (
            <span className="font-medium">{p.label}</span>
          )}
        </td>
        <td className="p-2 font-mono text-[11px]">{p.endpoint}</td>
        <td className="p-2">
          {p.categoryLabel && (
            <Badge variant="outline" className="text-[10px]">
              {p.categoryLabel}
            </Badge>
          )}
        </td>
        <td className="p-2 text-right tabular-nums">
          {p.retryCount}/{p.maxRetries}
        </td>
        <td className="p-2 text-[11px] text-muted-foreground max-w-[260px] truncate" title={p.errorMessage ?? ""}>
          {p.resultCode ? `[${p.resultCode}] ` : ""}
          {p.errorMessage}
        </td>
        <td className="p-2 text-right whitespace-nowrap">
          <Button size="sm" variant="ghost" onClick={onRetry} disabled={retrying} title="Tentar novamente">
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          {p.portalUrl && (
            <Button size="sm" variant="ghost" asChild title="Abrir portal oficial">
              <a href={p.portalUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/20">
          <td></td>
          <td colSpan={6} className="p-3">
            {loadingAttempts ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando tentativas…
              </p>
            ) : data ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium mb-1">Tentativas ({data.attempts.length})</p>
                  <ul className="space-y-1">
                    {data.attempts.map((a) => (
                      <li key={a.id} className="text-[11px] font-mono">
                        {new Date(a.createdAt).toLocaleString("pt-BR")} · {a.fromStatus ?? "—"}→{a.toStatus}
                        {a.reason ? ` · ${a.reason}` : ""}
                        {a.metadata && (a.metadata as { resultCode?: number }).resultCode != null
                          ? ` · cód ${(a.metadata as { resultCode?: number }).resultCode}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-muted-foreground">JSON do resultado</summary>
                  <pre className="mt-1 p-2 bg-background border rounded overflow-x-auto max-h-64">
                    {JSON.stringify(
                      { resultMessage: data.job.resultMessage, resultData: data.job.resultData, requestPayload: data.job.requestPayload },
                      null,
                      2
                    )}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sem histórico.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
