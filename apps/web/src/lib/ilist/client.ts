// Client HTTP da RexAPI (Gryphtech RE/MAX) — somente uso server-side.
//
// Quirks verificados ao vivo (2026-07-23, região 71 — ver
// docs/integracoes/ilist-rexapi-study.md):
//  - Token: POST /api/v1/oauth/token com body URL-encoded que DEVE começar com
//    "=" (sem ele a API não autentica). Token vale 48h, SEM refresh — cache em
//    memória com TTL de 40h + re-auth única em 401.
//  - Header: `Authorization: OAUTH oauth_token="...", api_key="..."`.
//  - O token é GLOBAL: acessa todas as regiões. O isolamento por tenant é
//    responsabilidade do chamador (integratorId SEMPRE derivado da conexão).
//  - Sentinela -999 = campo vazio em numéricos (normalizada aqui).
//  - Typo da API: respostas de property trazem `ExternaID` além de `ExternalID`.
//  - SEGURANÇA: respostas de offices/associates trazem `IListCredentials`
//    { Username, Password } EM TEXTO CLARO — redigido aqui, antes de qualquer
//    retorno/log/persistência.

import { getIListEnv, type IListEnv } from "./env";
import type {
  IListAssociate,
  IListGeoCityRow,
  IListLookupItem,
  IListOffice,
  IListPagedResponse,
  IListProperty,
  IListPropertyDescription,
  IListPropertyImage,
} from "./types";

export class IListError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly endpoint: string,
  ) {
    super(`[iList ${endpoint}] HTTP ${status}: ${message}`);
    this.name = "IListError";
  }
}

/** integratorId da RexAPI é derivado da região: {regionId}001. */
export function integratorIdForRegion(regionId: number): number {
  return Number(`${regionId}001`);
}

/** Sentinela -999 (numérica ou string) → undefined. */
export function fromSentinel(v: number | undefined | null): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n) || n === -999) return undefined;
  return n;
}

/**
 * Remove `IListCredentials` (senha em claro!) e normaliza o typo `ExternaID`.
 * Aplicado a TODO objeto vindo da API antes de retornar ao chamador.
 */
export function redactIListRecord<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = { ...record };
  delete out.IListCredentials;
  if (out.ExternaID !== undefined) {
    if (out.ExternalID === undefined) out.ExternalID = out.ExternaID;
    delete out.ExternaID;
  }
  return out as T;
}

function redactDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object") {
    return redactIListRecord(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v)]),
      ),
    ) as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Token cache (módulo). Token vale 48h; renovamos aos 40h pra folga de clock.
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 40 * 60 * 60 * 1000;

let tokenCache: { token: string; fetchedAt: number; key: string } | null = null;

function cacheKey(env: IListEnv): string {
  return `${env.baseUrl}|${env.apiKey}`;
}

async function fetchToken(env: IListEnv): Promise<string> {
  const inner = `grant_type=authorization_code&client_id=${env.apiKey}&code=${env.secretKey}`;
  // O "=" inicial é obrigatório (quirk validado — sem ele o token não sai).
  const body = "=" + encodeURIComponent(inner);
  const res = await fetch(`${env.baseUrl}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new IListError(res.status, "falha ao obter token OAuth", "oauth/token");
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new IListError(res.status, "resposta de token sem access_token", "oauth/token");
  }
  return json.access_token;
}

async function getToken(env: IListEnv, force = false): Promise<string> {
  const key = cacheKey(env);
  const now = Date.now();
  if (!force && tokenCache && tokenCache.key === key && now - tokenCache.fetchedAt < TOKEN_TTL_MS) {
    return tokenCache.token;
  }
  const token = await fetchToken(env);
  tokenCache = { token, fetchedAt: now, key };
  return token;
}

/** Só para testes: zera o cache de token do módulo. */
export function __resetIListTokenCache(): void {
  tokenCache = null;
}

// ---------------------------------------------------------------------------
// Transporte com throttle (~4 req/s) + backoff em 429/5xx + re-auth em 401.
// Rate limit da RexAPI não é documentado — conservador de propósito.
// ---------------------------------------------------------------------------

const MIN_INTERVAL_MS = 250;
const RETRY_DELAYS_MS = [1000, 4000];

let lastRequestAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(): Promise<void> {
  const prev = throttleChain;
  let release!: () => void;
  throttleChain = new Promise((r) => (release = r));
  await prev;
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  release();
}

async function rawGet<T>(env: IListEnv, path: string): Promise<T> {
  let attempt = 0;
  let reauthed = false;
  for (;;) {
    await throttle();
    const token = await getToken(env);
    const res = await fetch(`${env.baseUrl}/api/v1/${path}`, {
      headers: {
        Authorization: `OAUTH oauth_token="${token}", api_key="${env.apiKey}"`,
        Accept: "application/json",
      },
    });

    if (res.status === 401 && !reauthed) {
      // Token expirado/na fronteira dos 48h → re-auth única.
      reauthed = true;
      await getToken(env, true);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      attempt++;
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new IListError(res.status, text.slice(0, 300) || res.statusText, path);
    }
    const json = (await res.json()) as T;
    return redactDeep(json);
  }
}

// ---------------------------------------------------------------------------
// Client tipado por região
// ---------------------------------------------------------------------------

export interface IListListParams {
  page: number;
  take: number; // máx 100 (limite da API)
  all?: boolean;
  startDate?: Date; // filtro sobre ModifiedDate
  officeID?: number;
  associateID?: number;
}

function listQuery(params: IListListParams): string {
  const q = new URLSearchParams();
  q.set("page", String(params.page));
  q.set("take", String(Math.min(params.take, 100)));
  if (params.all) q.set("all", "true");
  if (params.startDate) q.set("startDate", params.startDate.toISOString().slice(0, 19));
  if (params.officeID !== undefined) q.set("officeID", String(params.officeID));
  if (params.associateID !== undefined) q.set("associateID", String(params.associateID));
  return q.toString();
}

export function createIListClient(regionId: number, envOverride?: IListEnv) {
  const env = envOverride ?? getIListEnv();
  const integrator = integratorIdForRegion(regionId);
  const base = `integrator/${integrator}`;

  return {
    regionId,
    integratorId: integrator,

    offices: {
      list: (params: IListListParams) =>
        rawGet<IListPagedResponse<IListOffice>>(env, `${base}/offices?${listQuery(params)}`),
    },

    associates: {
      list: (params: IListListParams) =>
        rawGet<IListPagedResponse<IListAssociate>>(env, `${base}/associates?${listQuery(params)}`),
    },

    properties: {
      list: (params: IListListParams) =>
        rawGet<IListPagedResponse<IListProperty>>(env, `${base}/properties?${listQuery(params)}`),
      get: (idOrExt: string) =>
        rawGet<IListProperty>(env, `${base}/properties/${encodeURIComponent(idOrExt)}`),
    },

    propertyDescriptions: {
      list: (propertyId: string) =>
        rawGet<IListPagedResponse<IListPropertyDescription>>(
          env,
          `${base}/propertydescriptions/${encodeURIComponent(propertyId)}`,
        ),
    },

    propertyImages: {
      list: (propertyId: string) =>
        rawGet<IListPropertyImage[]>(
          env,
          `${base}/propertyImages/${encodeURIComponent(propertyId)}`,
        ),
    },

    geodata: {
      /** Multi-criteria paginado — usado pra baixar todas as cidades da região. */
      cities: (page: number, take = 100) =>
        rawGet<IListPagedResponse<IListGeoCityRow>>(
          env,
          `${base}/geodata?page=${page}&take=${take}&geoLevel=cities`,
        ),
    },

    lookups: {
      get: (lookupName: string) =>
        rawGet<IListPagedResponse<IListLookupItem>>(
          env,
          `${base}/lookups?lookupName=${encodeURIComponent(lookupName)}`,
        ),
    },
  };
}

export type IListClient = ReturnType<typeof createIListClient>;
