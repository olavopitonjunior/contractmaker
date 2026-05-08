"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvelopeRow as BaseEnvelopeRow } from "./useEnvelopePolling";

/**
 * Variante do `useEnvelopePolling` ancorada no Deal — vê tanto envelopes
 * gerados a partir de Contract aprovado quanto envelopes avulsos (DealAttachment).
 *
 * O endpoint `GET /api/deals/[dealId]/envelopes` enriquece cada row com
 * `source` ("contract" | "attachment") e `subjectLabel` (string legível
 * pra header de cada card) — evita lookup no client.
 */
export interface DealEnvelopeRow extends BaseEnvelopeRow {
  source: "contract" | "attachment";
  subjectLabel: string;
  contractId: string | null;
  attachmentId: string | null;
}

const ACTIVE_STATUSES = new Set(["pending", "notified", "viewed"]);
const POLL_INTERVAL_MS = 3500;

export function useDealEnvelopePolling(dealId: string) {
  const [envelopes, setEnvelopes] = useState<DealEnvelopeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEnvelopes = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/envelopes`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { envelopes: DealEnvelopeRow[] };
      setEnvelopes(json.envelopes ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar envelopes");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchEnvelopes();
      if (cancelled) return;
      const hasActive = (es: DealEnvelopeRow[]) =>
        es.some(
          (e) =>
            e.status === "running" &&
            e.signers.some((s) => ACTIVE_STATUSES.has(s.status))
        );
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
