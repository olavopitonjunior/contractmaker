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
    | "skipped";
  resultCode: number | null;
  resultMessage: string | null;
  resultData: unknown;
  attachmentId: string | null;
  attachment: { id: string; filename: string; mime: string } | null;
  errorMessage: string | null;
  latencyMs: number | null;
  costCents: number | null;
  expectedReadyAt: string | null;
  retryCount: number;
  createdAt: string;
}

const TERMINAL = new Set(["success", "failed", "skipped", "awaiting_portal"]);

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

  const extract = useCallback(async () => {
    const batchId = crypto.randomUUID();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/certidoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
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
  }, [dealId, fetchJobs, startPolling]);

  const retry = useCallback(
    async (jobId: string) => {
      await fetch(`/api/deals/${dealId}/certidoes/${jobId}/retry`, {
        method: "POST",
      });
      await fetchJobs();
      // Resume polling briefly to catch the retry result
      const current = jobs.find((j) => j.id === jobId);
      if (current) {
        startPolling(current.batchId);
      }
    },
    [dealId, fetchJobs, startPolling, jobs]
  );

  return { jobs, loading, error, extract, retry, refresh: fetchJobs };
}
