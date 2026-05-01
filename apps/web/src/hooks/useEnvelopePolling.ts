"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface EnvelopeSignerRow {
  id: string;
  clicksignId: string | null;
  sourceKind: "vendedor" | "comprador";
  sourceIndex: number;
  name: string;
  email: string;
  documentation: string | null;
  authMethod: string;
  status: "pending" | "notified" | "viewed" | "signed" | "refused" | "removed";
  notifiedAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  refusedAt: string | null;
  resendCount: number;
  lastResendAt: string | null;
}

export interface EnvelopeRow {
  id: string;
  clicksignId: string | null;
  name: string;
  status: "draft" | "running" | "closed" | "canceled" | "failed";
  authMethod: string;
  documentUrl: string | null;
  signedDocumentUrl: string | null;
  costCents: number;
  deadlineAt: string | null;
  sentAt: string | null;
  closedAt: string | null;
  canceledAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  signers: EnvelopeSignerRow[];
}

const ACTIVE_STATUSES = new Set(["pending", "notified", "viewed"]);
const POLL_INTERVAL_MS = 3500;

export function useEnvelopePolling(contractId: string) {
  const [envelopes, setEnvelopes] = useState<EnvelopeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEnvelopes = useCallback(async () => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/envelopes`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { envelopes: EnvelopeRow[] };
      setEnvelopes(json.envelopes ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar envelopes");
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchEnvelopes();
      if (cancelled) return;
      const hasActive = (es: EnvelopeRow[]) =>
        es.some(
          (e) =>
            e.status === "running" &&
            e.signers.some((s) => ACTIVE_STATUSES.has(s.status))
        );
      // Re-leia o estado atual
      setEnvelopes((prev) => {
        if (hasActive(prev)) {
          timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
        }
        return prev;
      });
    };
    tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchEnvelopes]);

  return { envelopes, loading, error, refetch: fetchEnvelopes };
}
