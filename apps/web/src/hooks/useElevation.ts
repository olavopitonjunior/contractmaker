"use client";
import { useCallback } from "react";

type ElevationScope =
  | "TRANSFER"
  | "KYC_EDIT"
  | "BANK_ACCOUNT"
  | "API_KEY_ROTATE"
  | "MEMBER_MANAGE"
  | "FEES_CONFIG";

const ALL_SCOPES: ElevationScope[] = [
  "TRANSFER",
  "KYC_EDIT",
  "BANK_ACCOUNT",
  "API_KEY_ROTATE",
  "MEMBER_MANAGE",
  "FEES_CONFIG",
];

/**
 * DESATIVADO (2026-07-30, decisão do Olavo): a confirmação de identidade
 * (senha + 2FA a cada 15min) saiu de todas as operações. O hook passa a
 * reportar "sempre elevado com todos os scopes" — os checks preventivos
 * `hasScope()` das telas (membros, gerentes, transferências, onboarding,
 * dual-approvals) deixam de abrir o ElevationDialog, e o servidor
 * (lib/security/elevation.ts::requireElevation) é no-op no mesmo commit.
 * A API /api/security/elevation e o dialog seguem no código, inertes —
 * religar = reverter este arquivo e o elevation.ts (git log de ambos).
 */
export function useElevation() {
  const elevate = useCallback(
    async (_params: {
      password: string;
      code?: string;
      recoveryCode?: string;
      scopes: ElevationScope[];
    }): Promise<
      | { ok: true; scopes: ElevationScope[]; expiresAt: string }
      | { ok: false; error: string }
    > => {
      return {
        ok: true,
        scopes: ALL_SCOPES,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    },
    []
  );

  const revoke = useCallback(async () => {}, []);
  const refresh = useCallback(async () => {}, []);
  const hasScope = useCallback((_scope: ElevationScope) => true, []);

  return {
    elevated: true,
    scopes: ALL_SCOPES,
    loading: false,
    elevate,
    revoke,
    refresh,
    hasScope,
  };
}
