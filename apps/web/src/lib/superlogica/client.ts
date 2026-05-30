// Cliente HTTP da API Superlógica Imobiliárias (somente LEITURA por ora).
//
// Base e quirks verificados ao vivo em 2026-05-29 (licença adm037585) — ver
// docs/locacao/superlogica-api-benchmark.md e superlogica-api-data-dictionary.md.
//
// Quirks importantes encapsulados aqui:
//  - O transporte responde SEMPRE HTTP 200; o status real vem no corpo JSON
//    (`status: "200" | "404" | "500"`). Por isso checamos o corpo, não res.status.
//  - Datas de ENTRADA precisam ir em MM/DD/YYYY (formato americano).
//  - Todos os valores voltam como STRING (inclusive números/flags "0"/"1").
//  - Paginação: 50/página por padrão; `itensPorPagina` até ~200 (acima disso a
//    Superlógica bloqueia por anti-abuso).

export interface SuperlogicaCredentials {
  /** Token do aplicativo (global, mesmo para todas as licenças). */
  appToken: string;
  /** Token de acesso da licença/base (um por cliente). */
  accessToken: string;
  /** Override da base URL. Default: produção. */
  baseUrl?: string;
}

export interface SuperlogicaResponse<T> {
  status: string; // "200" | "404" | "500"
  msg: string;
  session?: string;
  data: T[];
  executiontime?: string;
}

export type SuperlogicaQuery = Record<string, string | number | boolean | undefined>;

export const SUPERLOGICA_BASE_URL = "https://apps.superlogica.net/imobiliaria/api/";

/** Teto seguro de itens por página antes do bloqueio anti-abuso. */
export const MAX_ITENS_POR_PAGINA = 200;

export class SuperlogicaError extends Error {
  constructor(
    public readonly status: string,
    message: string,
    public readonly endpoint: string,
  ) {
    super(`[Superlógica ${endpoint}] status ${status}: ${message}`);
    this.name = "SuperlogicaError";
  }
}

/** Formata um Date para o padrão exigido pela API (MM/DD/YYYY). */
export function toSuperlogicaDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** Converte string da API ("1234.56") em number; "" / null → undefined. */
export function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

/** Flags da API: "1" → true, "0"/""/null → false. */
export function toBool(v: unknown): boolean {
  return v === "1" || v === 1 || v === true;
}

/**
 * Parseia data da API. Saídas costumam vir "YYYY-MM-DD"; também aceita
 * "MM/DD/YYYY". Âncora ao meio-dia local pra evitar drift de timezone (UTC-3).
 */
export function parseSuperlogicaDate(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
  if (iso) {
    y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]);
  } else if (us) {
    m = Number(us[1]); d = Number(us[2]); y = Number(us[3]);
  } else {
    return undefined;
  }
  return new Date(y, m - 1, d, 12, 0, 0);
}

function buildUrl(base: string, resource: string, query: SuperlogicaQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return `${base}${resource}${qs ? `?${qs}` : ""}`;
}

/**
 * GET de uma página. Lança SuperlogicaError quando o corpo traz status != 200.
 */
export async function slGet<T = Record<string, unknown>>(
  creds: SuperlogicaCredentials,
  resource: string,
  query: SuperlogicaQuery = {},
): Promise<SuperlogicaResponse<T>> {
  const base = creds.baseUrl ?? SUPERLOGICA_BASE_URL;
  const url = buildUrl(base, resource, query);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      app_token: creds.appToken,
      access_token: creds.accessToken,
      Accept: "application/json",
    },
  });

  // Mesmo erros de transporte (raros) viram erro tipado.
  if (!res.ok) {
    throw new SuperlogicaError(String(res.status), `HTTP ${res.status}`, resource);
  }

  const json = (await res.json()) as SuperlogicaResponse<T>;
  if (json.status && json.status !== "200") {
    throw new SuperlogicaError(json.status, json.msg || "erro sem mensagem", resource);
  }
  // Algumas respostas vêm como data: [[{...}]] (array de array) — normaliza.
  if (Array.isArray(json.data) && json.data.length > 0 && Array.isArray(json.data[0])) {
    json.data = (json.data as unknown as T[][]).flat();
  }
  return json;
}

/**
 * GET paginado automático. Acumula todas as páginas até esgotar (página com
 * menos itens que o pageSize encerra). `maxPages` é um guarda de segurança.
 */
export async function slGetAll<T = Record<string, unknown>>(
  creds: SuperlogicaCredentials,
  resource: string,
  query: SuperlogicaQuery = {},
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = Math.min(opts.pageSize ?? 50, MAX_ITENS_POR_PAGINA);
  const maxPages = opts.maxPages ?? 200;
  const out: T[] = [];
  for (let pagina = 1; pagina <= maxPages; pagina++) {
    const resp = await slGet<T>(creds, resource, {
      ...query,
      pagina,
      itensPorPagina: pageSize,
    });
    out.push(...resp.data);
    // Para quando a página não vem "cheia". Inclui o caso de endpoints que
    // IGNORAM `itensPorPagina` e devolvem tudo de uma vez (ex.: `seguros`
    // retorna o conjunto inteiro independente do limite) — aí length > pageSize
    // e paginar de novo só repetiria os mesmos registros.
    if (resp.data.length !== pageSize) break;
  }
  return out;
}
