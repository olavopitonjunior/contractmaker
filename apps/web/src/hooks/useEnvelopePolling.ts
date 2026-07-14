"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface EnvelopeSignerRow {
  id: string;
  clicksignId: string | null;
  sourceKind: "vendedor" | "comprador" | "testemunha" | "corretora" | "outro" | string;
  sourceIndex: number;
  /** Qualificação ClickSign ("Assina como"). */
  role: string | null;
  /** Grupo de ordem de assinatura (null = paralelo). */
  signingGroup: number | null;
  name: string;
  email: string;
  documentation: string | null;
  authMethod: string;
  status:
    | "pending"
    | "notified"
    | "viewed"
    | "signed"
    | "refused"
    | "removed"
    | "email_failed";
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

const hasActive = (es: EnvelopeRow[]) =>
  es.some(
    (e) =>
      e.status === "running" &&
      e.signers.some((s) => ACTIVE_STATUSES.has(s.status))
  );

export function useEnvelopePolling(contractId: string) {
  const [envelopes, setEnvelopes] = useState<EnvelopeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const fetchEnvelopes = useCallback(async () => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/envelopes`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { envelopes: EnvelopeRow[] };
      const next = json.envelopes ?? [];
      setEnvelopes(next);
      setError(null);
      // Re-arma o polling sempre que tiver envelope ativo, inclusive
      // após `refetch` externo (ex: após criar envelope na popup). Antes
      // do fix, polling parava quando carga inicial não tinha ativos e
      // refetch nunca reagendava.
      if (!cancelledRef.current && hasActive(next)) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(fetchEnvelopes, POLL_INTERVAL_MS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar envelopes");
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    cancelledRef.current = false;
    fetchEnvelopes();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchEnvelopes]);

  return { envelopes, loading, error, refetch: fetchEnvelopes };
}
