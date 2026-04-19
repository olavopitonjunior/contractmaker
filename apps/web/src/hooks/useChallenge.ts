"use client";
import { useCallback, useState } from "react";

type ChallengeKind =
  | "TRANSFER"
  | "BANK_ACCOUNT_CHANGE"
  | "SUBACCOUNT_DELETE"
  | "DUAL_APPROVE"
  | "FEES_CHANGE";

export function useChallenge() {
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async (kind: ChallengeKind, payloadHash: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/security/challenges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ kind, payloadHash }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Falha ao enviar código");
          return { ok: false as const };
        }
        setChallengeId(data.id);
        setSentTo(data.sentTo);
        setExpiresAt(new Date(data.expiresAt));
        return { ok: true as const, id: data.id };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const confirm = useCallback(
    async (code: string) => {
      if (!challengeId) return { ok: false as const, error: "Nenhum challenge ativo" };
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/security/challenges/${challengeId}/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ code }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Código inválido");
          return { ok: false as const, error: data.error };
        }
        setToken(data.token);
        return { ok: true as const, token: data.token };
      } finally {
        setLoading(false);
      }
    },
    [challengeId]
  );

  const cancel = useCallback(async () => {
    if (!challengeId) return;
    await fetch(`/api/security/challenges/${challengeId}`, {
      method: "DELETE",
      credentials: "include",
    });
    setChallengeId(null);
    setSentTo(null);
    setToken(null);
  }, [challengeId]);

  const reset = useCallback(() => {
    setChallengeId(null);
    setSentTo(null);
    setToken(null);
    setError(null);
    setExpiresAt(null);
  }, []);

  return {
    challengeId,
    sentTo,
    expiresAt,
    token,
    loading,
    error,
    request,
    confirm,
    cancel,
    reset,
  };
}

export async function computePayloadHash(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload, Object.keys(payload as object).sort());
  const buffer = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
