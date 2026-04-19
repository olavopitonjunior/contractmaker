"use client";
import { useCallback, useEffect, useState } from "react";

type ElevationScope =
  | "TRANSFER"
  | "KYC_EDIT"
  | "BANK_ACCOUNT"
  | "API_KEY_ROTATE"
  | "MEMBER_MANAGE"
  | "FEES_CONFIG";

interface ElevationStatus {
  elevated: boolean;
  scopes: ElevationScope[];
}

export function useElevation() {
  const [status, setStatus] = useState<ElevationStatus>({ elevated: false, scopes: [] });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/security/elevation", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setStatus({ elevated: !!data.elevated, scopes: data.scopes ?? [] });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const elevate = useCallback(
    async (params: {
      password: string;
      code?: string;
      recoveryCode?: string;
      scopes: ElevationScope[];
    }) => {
      const res = await fetch("/api/security/elevation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false as const, error: data.error ?? "Erro desconhecido" };
      }
      await refresh();
      return { ok: true as const, scopes: data.scopes, expiresAt: data.expiresAt };
    },
    [refresh]
  );

  const revoke = useCallback(async () => {
    await fetch("/api/security/elevation", {
      method: "DELETE",
      credentials: "include",
    });
    await refresh();
  }, [refresh]);

  const hasScope = useCallback(
    (scope: ElevationScope) => status.elevated && status.scopes.includes(scope),
    [status]
  );

  return { ...status, loading, elevate, revoke, refresh, hasScope };
}
