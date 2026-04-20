/**
 * Client HTTP da API Asaas — fetch wrapper com:
 * - Master API key padrão (env ASAAS_API_KEY) OU subaccount apiKey por request
 * - Sandbox/prod baseURL via env ASAAS_ENV
 * - Retry exponencial em 429/5xx (até 3x)
 * - Guard: ASAAS_ENV=production + apiKey começando com "$aact_YT" (sandbox) → throw
 * - Parse de erro → AsaasError
 */

import { ASAAS_BASE_URLS, type AsaasEnv } from "./types";
import { parseAsaasErrorResponse, AsaasError } from "./errors";

interface AsaasFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Override da api key (ex: subconta). Se ausente, usa ASAAS_API_KEY (master). */
  apiKey?: string;
  /** Timeout em ms. Default 30s. */
  timeoutMs?: number;
  /** Retry automático em 429/5xx. Default true. */
  retry?: boolean;
  /** Headers extras. */
  headers?: Record<string, string>;
  /** Para uploads multipart — se presente, body é FormData. */
  isMultipart?: boolean;
}

function getEnv(): AsaasEnv {
  const env = (process.env.ASAAS_ENV ?? "sandbox") as AsaasEnv;
  if (env !== "sandbox" && env !== "production") {
    throw new Error(`ASAAS_ENV inválido: ${env}. Use "sandbox" ou "production".`);
  }
  return env;
}

function getMasterApiKey(): string {
  const key = process.env.ASAAS_API_KEY;
  if (!key) {
    throw new Error(
      "ASAAS_API_KEY ausente. Configure no .env (dev) ou Vercel env (prod)."
    );
  }
  return key;
}

function assertEnvConsistency(apiKey: string, env: AsaasEnv) {
  // Sandbox keys historicamente começam com $aact_YT (v2) ou $aact_hmlg (v3).
  const isSandboxKey =
    apiKey.startsWith("$aact_YT") || apiKey.startsWith("$aact_hmlg");
  if (env === "production" && isSandboxKey) {
    throw new Error(
      "Inconsistência: ASAAS_ENV=production mas API key parece sandbox ($aact_YT ou $aact_hmlg)"
    );
  }
  if (env === "sandbox" && apiKey.startsWith("$aact_prod")) {
    throw new Error(
      "Inconsistência: ASAAS_ENV=sandbox mas API key parece produção ($aact_prod...)"
    );
  }
}

function buildQueryString(
  query?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined) continue;
    params.append(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Core fetch com retry.
 */
async function doFetch(
  path: string,
  options: AsaasFetchOptions = {}
): Promise<Response> {
  const env = getEnv();
  const apiKey = options.apiKey ?? getMasterApiKey();
  assertEnvConsistency(apiKey, env);

  const baseUrl = ASAAS_BASE_URLS[env];
  const url = baseUrl + path + buildQueryString(options.query);

  const headers: Record<string, string> = {
    access_token: apiKey,
    Accept: "application/json",
    "User-Agent": "Contractmaker/1.0 (pagadoria)",
    ...options.headers,
  };

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.isMultipart) {
      body = options.body as FormData;
      // Content-Type setado automaticamente pelo runtime com boundary
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryEnabled = options.retry ?? true;
  const maxAttempts = retryEnabled ? 3 : 1;

  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // Retry em 429 ou 5xx
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err as Error;
      if (attempt >= maxAttempts) break;
      await sleep(500 * attempt);
    }
  }

  throw lastErr ?? new Error("Asaas fetch failed");
}

/**
 * Fetch tipado — parseia JSON e lança AsaasError em !ok.
 */
export async function asaasFetch<T = unknown>(
  path: string,
  options: AsaasFetchOptions = {}
): Promise<T> {
  const res = await doFetch(path, options);
  if (!res.ok) {
    throw await parseAsaasErrorResponse(res, path);
  }
  // 204 no content
  if (res.status === 204) return null as T;
  try {
    return (await res.json()) as T;
  } catch {
    return null as T;
  }
}

/**
 * Helper para verificar se API key está válida sem fazer operações.
 * Retorna `{ ok: true }` se bate, senão descreve o erro.
 */
export async function pingAsaas(apiKey?: string): Promise<
  | { ok: true; env: AsaasEnv }
  | { ok: false; error: string; status?: number }
> {
  try {
    // GET /customers?limit=1 é o menor endpoint read que confirma auth
    await asaasFetch("/customers", {
      query: { limit: 1 },
      apiKey,
      retry: false,
    });
    return { ok: true, env: getEnv() };
  } catch (err) {
    if (err instanceof AsaasError) {
      return {
        ok: false,
        error: err.message,
        status: err.status,
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
