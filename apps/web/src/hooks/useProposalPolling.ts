"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ProposalSignerStatus {
  id: string;
  via: string;
  name: string;
  role: string | null;
  channel: string;
  status: string; // pending|notified|viewed|signed|refused|email_failed|removed
  signingGroup: number | null;
  viewedAt: string | null;
  signedAt: string | null;
  refusedAt: string | null;
}

export interface ProposalStatusPayload {
  status: string;
  dossierUrl: string | null;
  convertedDealId: string | null;
  envelopes: { id: string; via: string; status: string }[];
  signers: ProposalSignerStatus[];
  active: boolean;
  updatedAt: string;
}

const POLL_INTERVAL_MS = 3500;

/**
 * Polling em tempo real do estado de uma proposta (molde do `useEnvelopePolling`
 * dos contratos). Bate no GET /api/proposals/[id]/status (leitura de DB, que o
 * webhook atualiza) enquanto `active` — para sozinho quando a proposta chega a um
 * terminal. `onStatusChange` dispara quando o status muda (pra `router.refresh`).
 */
export function useProposalPolling(
  proposalId: string,
  opts: { enabled?: boolean; onStatusChange?: (status: string) => void } = {}
) {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<ProposalStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const lastStatusRef = useRef<string | null>(null);
  const onChangeRef = useRef(opts.onStatusChange);
  onChangeRef.current = opts.onStatusChange;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/status`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ProposalStatusPayload;
      setData(json);
      setError(null);

      if (lastStatusRef.current !== null && lastStatusRef.current !== json.status) {
        onChangeRef.current?.(json.status);
      }
      lastStatusRef.current = json.status;

      if (!cancelledRef.current && json.active) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(fetchStatus, POLL_INTERVAL_MS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar status");
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    if (!enabled) return;
    cancelledRef.current = false;
    fetchStatus();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, fetchStatus]);

  return { data, loading, error, refetch: fetchStatus };
}
