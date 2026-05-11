"use client";

import { useSearchParams } from "next/navigation";

/**
 * Lê `?accountId=` do URL atual. Retorna `null` se ausente.
 * Páginas client-component em /financeiro/* usam pra propagar accountId
 * nos fetches de API. Quando ausente, server resolve via conta ativa.
 */
export function useAccountIdParam(): string | null {
  const searchParams = useSearchParams();
  return searchParams?.get("accountId") ?? null;
}

/**
 * Helper pra adicionar `accountId=...` num URLSearchParams ou path.
 * Sem-op se accountId for null/empty.
 */
export function withAccountId(
  params: URLSearchParams,
  accountId: string | null
): URLSearchParams {
  if (accountId) params.set("accountId", accountId);
  return params;
}
