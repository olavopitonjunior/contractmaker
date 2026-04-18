"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface CertidaoJobRow {
  id: string;
  dealId: string;
  batchId: string;
  endpoint: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  status:
    | "pending"
    | "fetching"
    | "awaiting_portal"
    | "success"
    | "failed"
    // J.3 (Phase J, 2026-04-18) — estados semânticos ricos
    | "api_error"
    | "portal_unavailable"
    | "rate_limited"
    | "data_missing"
    | "data_invalid"
    | "informativo"
    | "failed_permanent"
    | "skipped"
    | "replaced";
  requestPayload: unknown;
  resultCode: number | null;
  resultMessage: string | null;
  resultData: unknown;
  attachmentId: string | null;
  attachment: { id: string; filename: string; mime: string } | null;
  errorMessage: string | null;
  latencyMs: number | null;
  costCents: number | null;
  expectedReadyAt: string | null;
  // J.2 (Phase J)
  nextRetryAt: string | null;
  maxRetries: number;
  missingFields: string[];
  portalUrl: string | null;
  retryCount: number;
  createdAt: string;
}

const TERMINAL = new Set([
  "success",
  "failed",
  "failed_permanent",
  "skipped",
  "awaiting_portal",
  "replaced",
  "informativo",
  // J: data_missing / data_invalid são terminais (precisam user action),
  // não retry auto. api_error / portal_unavailable / rate_limited NÃO
  // são terminais — cron vai retentar.
  "data_missing",
  "data_invalid",
]);

/**
 * Polls /api/deals/:dealId/certidoes every 2s while any job is still in a
 * non-terminal state. Stops when all jobs are terminal or after 10min hard cap.
 */
export function useCertidoesBatch(dealId: string) {
  const [jobs, setJobs] = useState<CertidaoJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  const fetchJobs = useCallback(
    async (batchId?: string) => {
      try {
        const qs = batchId ? `?batchId=${batchId}` : "";
        const res = await fetch(`/api/deals/${dealId}/certidoes${qs}`);
        if (!res.ok) {
          setError("Falha ao carregar certidões");
          return null;
        }
        const data = await res.json();
        setJobs(data.jobs ?? []);
        setLoading(false);
        return data.jobs as CertidaoJobRow[];
      } catch (err) {
        setError(err instanceof Error ? err.message : "erro");
        return null;
      }
    },
    [dealId]
  );

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (batchId: string) => {
      stopPolling();
      startedAtRef.current = Date.now();
      pollingRef.current = setInterval(async () => {
        const next = await fetchJobs(batchId);
        if (!next) return;
        const allTerminal = next.every((j) => TERMINAL.has(j.status));
        const elapsedMs = Date.now() - startedAtRef.current;
        if (allTerminal || elapsedMs > 10 * 60_000) {
          stopPolling();
        }
      }, 2000);
    },
    [fetchJobs, stopPolling]
  );

  useEffect(() => {
    fetchJobs();
    return () => stopPolling();
  }, [fetchJobs, stopPolling]);

  const extract = useCallback(
    async (
      jobs?: Array<{
        endpoint: string;
        targetKind: "vendedor" | "comprador" | "imovel" | "diligenciado";
        targetIndex: number;
      }>
    ) => {
      const batchId = crypto.randomUUID();
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/deals/${dealId}/certidoes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jobs ? { batchId, jobs } : { batchId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Falha ao iniciar extração");
          setLoading(false);
          return null;
        }
        await fetchJobs(batchId);
        startPolling(batchId);
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "erro");
        setLoading(false);
        return null;
      }
    },
    [dealId, fetchJobs, startPolling]
  );

  const retry = useCallback(
    async (jobId: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch(
        `/api/deals/${dealId}/certidoes/${jobId}/retry`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "Falha ao tentar novamente" };
      }
      await fetchJobs();
      const current = jobs.find((j) => j.id === jobId);
      if (current) {
        startPolling(current.batchId);
      }
      return { ok: true };
    },
    [dealId, fetchJobs, startPolling, jobs]
  );

  const deleteJob = useCallback(
    async (jobId: string): Promise<boolean> => {
      const res = await fetch(`/api/deals/${dealId}/certidoes/${jobId}`, {
        method: "DELETE",
      });
      if (!res.ok) return false;
      await fetchJobs();
      return true;
    },
    [dealId, fetchJobs]
  );

  const sweepStale = useCallback(async (): Promise<{
    promoted: number;
    failed: number;
  }> => {
    const res = await fetch(`/api/deals/${dealId}/certidoes/sweep`, {
      method: "POST",
    });
    if (!res.ok) return { promoted: 0, failed: 0 };
    const data = await res.json();
    await fetchJobs();
    return {
      promoted: data.promoted ?? 0,
      failed: data.failed ?? 0,
    };
  }, [dealId, fetchJobs]);

  const completeSkipped = useCallback(
    async (
      jobId: string,
      fields: Record<string, string | number | null>
    ): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch(
        `/api/deals/${dealId}/certidoes/${jobId}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "Falha ao complementar" };
      }
      await fetchJobs();
      const current = jobs.find((j) => j.id === jobId);
      if (current) startPolling(current.batchId);
      return { ok: true };
    },
    [dealId, fetchJobs, startPolling, jobs]
  );

  return {
    jobs,
    loading,
    error,
    extract,
    retry,
    deleteJob,
    sweepStale,
    completeSkipped,
    refresh: fetchJobs,
  };
}
