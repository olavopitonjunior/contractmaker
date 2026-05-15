/**
 * Cliente HTTP para a API Serasa Experian (REST v2).
 *
 * Autenticação:
 *   OAuth2 via POST {SERASA_BASE_URL}/security/iam/v1/user-identities/login
 *   ?clientId=<SERASA_CLIENT_ID>
 *   body: { clientSecret: <SERASA_CLIENT_SECRET> }
 *   → { accessToken, tokenType, expiresIn }
 *
 *   Token é cacheado (Upstash quando disponível, in-memory por instância caso
 *   contrário) com TTL = expiresIn - 60s (margem de segurança pra refresh
 *   proativo). Invalidação em 401: 1 retry imediato após refresh; depois,
 *   classifier do executor decide retry com backoff.
 *
 * Por que NÃO Bearer puro:
 *   Plano usa Authorization: Bearer <token> conforme padrão REST v2 do provider.
 *   Se o provedor exigir `?access_token=` na query (como ClickSign), troque
 *   `applyAuth` numa única linha.
 *
 * Limitações conhecidas:
 *   - API v1 (SOAP/REST legado) será desligada em 2026-07-01. Este cliente
 *     fala apenas v2 REST/JSON.
 *   - Sandbox vs produção: distinguido por SERASA_ENV + SERASA_BASE_URL.
 *   - Sem retry on network error além de 1 retry em 5xx (mesmo padrão de
 *     `infosimples.ts::callInfosimples`). Timeouts longos = retry pelo cron
 *     de outcome-classifier.
 */

import {
  SerasaError,
  type SerasaTokenResponse,
  type SerasaResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 60_000;

// ---- Token cache ------------------------------------------------------------

interface CachedToken {
  accessToken: string;
  tokenType: string;
  // epoch ms — quando o token deve ser considerado expirado (já com margem)
  expiresAt: number;
}

// In-memory fallback (instance-scoped). Em serverless, cada cold start zera.
let memoryToken: CachedToken | null = null;

const REDIS_KEY = "serasa:oauth:access_token";

async function readUpstashClient(): Promise<{
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, opts?: { ex?: number }) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
} | null> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  try {
    const { Redis } = await import("@upstash/redis");
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    }) as unknown as ReturnType<typeof readUpstashClient> extends Promise<infer R>
      ? R
      : never;
  } catch (err) {
    console.warn("[serasa] Upstash indisponível, usando token cache in-memory", err);
    return null;
  }
}

async function loadCachedToken(): Promise<CachedToken | null> {
  // Memory check first (faster, mesmo container reaproveita).
  if (memoryToken && memoryToken.expiresAt > Date.now()) return memoryToken;
  const upstash = await readUpstashClient();
  if (!upstash) return null;
  try {
    const raw = await upstash.get(REDIS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as CachedToken;
    if (parsed.expiresAt <= Date.now()) return null;
    memoryToken = parsed;
    return parsed;
  } catch (err) {
    console.warn("[serasa] erro lendo token cache do Upstash", err);
    return null;
  }
}

async function saveCachedToken(token: CachedToken): Promise<void> {
  memoryToken = token;
  const upstash = await readUpstashClient();
  if (!upstash) return;
  const ttlSeconds = Math.max(60, Math.floor((token.expiresAt - Date.now()) / 1000));
  try {
    await upstash.set(REDIS_KEY, JSON.stringify(token), { ex: ttlSeconds });
  } catch (err) {
    console.warn("[serasa] erro salvando token no Upstash", err);
  }
}

async function invalidateCachedToken(): Promise<void> {
  memoryToken = null;
  const upstash = await readUpstashClient();
  if (!upstash) return;
  try {
    await upstash.del(REDIS_KEY);
  } catch {
    /* swallow */
  }
}

// ---- Auth -------------------------------------------------------------------

function getCredentials(): { clientId: string; clientSecret: string; baseUrl: string } {
  const clientId = process.env.SERASA_CLIENT_ID?.trim();
  const clientSecret = process.env.SERASA_CLIENT_SECRET?.trim();
  const baseUrl = process.env.SERASA_BASE_URL?.trim();
  if (!clientId || !clientSecret || !baseUrl) {
    throw new Error(
      "Serasa não configurado. Defina SERASA_CLIENT_ID, SERASA_CLIENT_SECRET e SERASA_BASE_URL no .env."
    );
  }
  return { clientId, clientSecret, baseUrl: baseUrl.replace(/\/+$/, "") };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Realiza login OAuth2 e devolve o token bruto. NÃO usa cache — caller decide.
 */
async function loginSerasa(): Promise<CachedToken> {
  const { clientId, clientSecret, baseUrl } = getCredentials();
  const url = `${baseUrl}/security/iam/v1/user-identities/login?clientId=${encodeURIComponent(
    clientId
  )}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientSecret }),
    },
    DEFAULT_TIMEOUT_MS
  );
  const text = await res.text();
  let json: SerasaTokenResponse;
  try {
    json = JSON.parse(text) as SerasaTokenResponse;
  } catch {
    throw new SerasaError(
      `Login Serasa retornou resposta não-JSON (HTTP ${res.status})`,
      res.status,
      text.slice(0, 500)
    );
  }
  if (!res.ok || !json.accessToken) {
    const errMsg =
      ((json as unknown) as Record<string, unknown> | null)?.message ??
      "credenciais inválidas";
    throw new SerasaError(
      `Falha no login Serasa (HTTP ${res.status}): ${errMsg}`,
      res.status,
      json
    );
  }
  // Margem de 60s pra refresh proativo evitar expiração mid-call.
  const ttlMs = Math.max(60, (json.expiresIn ?? 3600) - 60) * 1000;
  return {
    accessToken: json.accessToken,
    tokenType: json.tokenType ?? "Bearer",
    expiresAt: Date.now() + ttlMs,
  };
}

async function getAccessToken(forceRefresh = false): Promise<CachedToken> {
  if (!forceRefresh) {
    const cached = await loadCachedToken();
    if (cached) return cached;
  }
  const fresh = await loginSerasa();
  await saveCachedToken(fresh);
  return fresh;
}

function applyAuth(headers: Record<string, string>, token: CachedToken): Record<string, string> {
  return {
    ...headers,
    Authorization: `${token.tokenType} ${token.accessToken}`,
  };
}

// ---- Public API -------------------------------------------------------------

export interface CallOptions {
  timeoutMs?: number;
  /**
   * Por padrão, em 401 o cliente invalida o cache e tenta UMA vez de novo.
   * Em casos pontuais (testes, ping de saúde), o caller pode desabilitar.
   */
  retryOn401?: boolean;
  /**
   * Por padrão, em 5xx o cliente tenta UMA vez sem invalidar token.
   */
  retryOn5xx?: boolean;
}

/**
 * Chama um endpoint Serasa com OAuth2 transparente.
 *
 * `endpointPath` é o caminho relativo a partir do baseUrl (sem barra inicial),
 * ex: `credit-services/v2/persons/score`.
 *
 * Devolve o JSON cru (typed como `SerasaResponse`). O normalizer dedicado
 * traduz pra `NormalizedResult` no executor.
 *
 * Em sucesso (HTTP 2xx) devolve o body parseado. Em erro lança `SerasaError`
 * carregando o body cru — o classifier roteia estado rico baseado no `status`.
 */
export async function callSerasa(
  endpointPath: string,
  body: Record<string, unknown>,
  options: CallOptions = {}
): Promise<{ status: number; body: SerasaResponse; raw: unknown }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOn401 = options.retryOn401 !== false;
  const retryOn5xx = options.retryOn5xx !== false;
  const { baseUrl } = getCredentials();
  const url = `${baseUrl}/${endpointPath.replace(/^\/+/, "")}`;

  const doRequest = async (token: CachedToken): Promise<Response> =>
    fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: applyAuth(
          { "Content-Type": "application/json", Accept: "application/json" },
          token
        ),
        body: JSON.stringify(body),
      },
      timeoutMs
    );

  let token = await getAccessToken();
  let res = await doRequest(token);

  // 401: cache stale ou revoked. Invalida, tenta 1x mais.
  if (res.status === 401 && retryOn401) {
    await invalidateCachedToken();
    token = await getAccessToken(true);
    res = await doRequest(token);
  }

  // 5xx: provider hiccup. 1 retry.
  if (res.status >= 500 && retryOn5xx) {
    res = await doRequest(token);
  }

  const text = await res.text();
  let parsed: SerasaResponse;
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as SerasaResponse) : ({} as SerasaResponse);
  } catch {
    throw new SerasaError(
      `Resposta Serasa não-JSON (HTTP ${res.status})`,
      res.status,
      text.slice(0, 500)
    );
  }

  if (!res.ok) {
    throw new SerasaError(
      `Serasa HTTP ${res.status}: ${
        (parsed as Record<string, unknown>).message ?? res.statusText
      }`,
      res.status,
      parsed
    );
  }

  return { status: res.status, body: parsed, raw: parsed };
}

/**
 * Helper de healthcheck — usado pelos scripts de smoke (S7) e diagnóstico.
 * NÃO usa cache de token; força login fresh pra detectar credenciais inválidas.
 */
export async function pingSerasa(): Promise<{ ok: true; tokenType: string; ttlSeconds: number }> {
  const token = await loginSerasa();
  await saveCachedToken(token);
  return {
    ok: true,
    tokenType: token.tokenType,
    ttlSeconds: Math.floor((token.expiresAt - Date.now()) / 1000),
  };
}

/**
 * Indica se o provider está configurado. Usado pelo planner pra evitar
 * incluir endpoints Serasa no auto-plan quando a integração não está ligada.
 */
export function isSerasaConfigured(): boolean {
  return (
    !!process.env.SERASA_CLIENT_ID?.trim() &&
    !!process.env.SERASA_CLIENT_SECRET?.trim() &&
    !!process.env.SERASA_BASE_URL?.trim()
  );
}
