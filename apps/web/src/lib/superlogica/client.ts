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

/**
 * API Financeiro/Assinaturas v2 — responde aos MESMOS tokens da licença
 * (verificado ao vivo em 2026-09-02): clientes (sacados), cobranca, caixa
 * (contas a pagar), produtos, planocontas. Devolve ARRAY direto no corpo (sem
 * o envelope {status,msg,data}); erro vem como objeto {status,msg} ou HTML.
 * Doc: https://apiassinaturas.superlogica.com
 */
export const SUPERLOGICA_V2_BASE_URL = "https://api.superlogica.net/v2/financeiro/";

/** Teto seguro de itens por página antes do bloqueio anti-abuso. */
export const MAX_ITENS_POR_PAGINA = 200;

/** Timeout por requisição (a API responde em ~1–3 s; 30 s cobre a v2 lenta). */
export const SUPERLOGICA_TIMEOUT_MS = 30_000;

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
    signal: AbortSignal.timeout(SUPERLOGICA_TIMEOUT_MS),
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

/**
 * GET na API v2 (Financeiro). Sempre paginar: `clientes` sem `pagina` estoura a
 * memória do servidor deles (Fatal error em HTML). Devolve o array cru.
 */
export async function slGetV2<T = Record<string, unknown>>(
  creds: SuperlogicaCredentials,
  resource: string,
  query: SuperlogicaQuery = {},
): Promise<T[]> {
  const url = buildUrl(SUPERLOGICA_V2_BASE_URL, resource, {
    pagina: 1,
    itensPorPagina: 50,
    ...query,
  });
  const res = await fetch(url, {
    method: "GET",
    headers: {
      app_token: creds.appToken,
      access_token: creds.accessToken,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(SUPERLOGICA_TIMEOUT_MS),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SuperlogicaError(
      String(res.status),
      `resposta não-JSON (${text.slice(0, 80).replace(/\s+/g, " ")})`,
      `v2/${resource}`,
    );
  }
  if (Array.isArray(json)) return json as T[];
  const obj = (json ?? {}) as { status?: string | number; msg?: string };
  throw new SuperlogicaError(
    String(obj.status ?? res.status),
    obj.msg || "erro sem mensagem",
    `v2/${resource}`,
  );
}

// ---------------------------------------------------------------------------
// ESCRITA — provada em produção em 2026-09-02/03 (licença adm037585):
// pessoas, imóveis, venda completa (`vendas/put`), alteração (`vendas/post`),
// despesa da venda (`vendas/lancardespesa`) e, na v2, clientes/cobranca/caixa.
// Ver docs/integracoes/superlogica-vendas-export.md.
// ---------------------------------------------------------------------------

/** Valor aceito num campo de formulário: escalar, ou objeto/array aninhado. */
export type FormValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | FormValue[]
  | { [key: string]: FormValue };

export type FormFields = { [key: string]: FormValue };

/**
 * Achata um objeto para a notação de colchetes que a tela da Superlógica
 * envia (`VENDEDORES[0][ID_VENDEDOR_VEV]=115`). `null` vira campo vazio —
 * o assistente manda `ID_ITEM_VEI=` em branco e o servidor espera a chave —
 * e `undefined` é omitido.
 */
export function flattenFormFields(
  fields: FormFields,
  prefix = "",
  out: Array<[string, string]> = [],
): Array<[string, string]> {
  for (const [key, value] of Object.entries(fields)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    appendFormValue(name, value, out);
  }
  return out;
}

function appendFormValue(name: string, value: FormValue, out: Array<[string, string]>): void {
  if (value === undefined) return;
  if (value === null) {
    out.push([name, ""]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => appendFormValue(`${name}[${i}]`, v, out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) appendFormValue(`${name}[${k}]`, v, out);
    return;
  }
  out.push([name, typeof value === "boolean" ? (value ? "1" : "0") : String(value)]);
}

export function encodeForm(fields: FormFields): string {
  const params = new URLSearchParams();
  for (const [k, v] of flattenFormFields(fields)) params.append(k, v);
  return params.toString();
}

/** Anti-duplicidade da Superlógica: "Já existe uma venda com essas informações. Venda#744". */
export class SuperlogicaDuplicateError extends SuperlogicaError {
  constructor(
    public readonly existingId: string,
    message: string,
    endpoint: string,
  ) {
    super("409", message, endpoint);
    this.name = "SuperlogicaDuplicateError";
  }
}

const DUPLICATE_RE = /j[áa] existe uma venda[\s\S]*?venda#\s*(\d+)/i;

function stripHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isOkStatus(status: unknown): boolean {
  const n = Number(status);
  return Number.isFinite(n) && n >= 200 && n < 300;
}

interface WriteEnvelope {
  status?: string | number;
  msg?: string;
  multipleresponse?: string;
  data?: unknown;
  idcolumnname?: string;
}

/**
 * Normaliza a resposta de escrita da Superlógica. Dois formatos convivem:
 *  - simples: `{status,msg,data}`;
 *  - lote: `{multipleresponse:"1", status:"200"|"206", data:[{status,msg,data}]}`
 *    (HTTP 200 mesmo com erro dentro — o status real é o do item).
 * Devolve o `data` do (primeiro) item, ou lança `SuperlogicaError` /
 * `SuperlogicaDuplicateError`.
 */
export function unwrapWriteResponse<T>(
  raw: unknown,
  endpoint: string,
  httpStatus: number,
): { data: T; msg: string } {
  // v2 devolve `[{status,msg,data}]` na raiz; Imobiliárias devolve o envelope
  // (simples ou `multipleresponse` com `data[]`).
  const env = (Array.isArray(raw) ? (raw[0] ?? {}) : (raw ?? {})) as WriteEnvelope;
  let item: WriteEnvelope = env;
  let status: string | number | undefined = env.status;
  if (env.multipleresponse === "1" && Array.isArray(env.data)) {
    // Em lote, o status que vale é o do ITEM — um lote vazio não criou nada.
    item = (env.data[0] ?? {}) as WriteEnvelope;
    status = item.status;
  }
  const msg = stripHtml(String(item.msg ?? env.msg ?? ""));
  // Sem `status` no corpo NÃO é sucesso: o transporte responde 200 sempre, e
  // um corpo vazio/`{}`/`[]` (manutenção, throttle, envelope novo) não prova
  // que nada foi criado. Erro tipado > `data` undefined silencioso.
  if (status === undefined) {
    throw new SuperlogicaError(
      String(httpStatus),
      `resposta sem status (${JSON.stringify(raw)?.slice(0, 120) ?? "vazia"})`,
      endpoint,
    );
  }
  if (!isOkStatus(status)) {
    const dup = DUPLICATE_RE.exec(msg);
    if (dup) throw new SuperlogicaDuplicateError(dup[1], msg, endpoint);
    throw new SuperlogicaError(String(status), msg || "erro sem mensagem", endpoint);
  }
  return { data: item.data as T, msg };
}

async function writeRequest<T>(
  creds: SuperlogicaCredentials,
  url: string,
  endpoint: string,
  method: "POST" | "PUT" | "DELETE",
  body: string,
  contentType: string,
): Promise<{ data: T; msg: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      app_token: creds.appToken,
      access_token: creds.accessToken,
      Accept: "application/json",
      "Content-Type": contentType,
    },
    body,
    signal: AbortSignal.timeout(SUPERLOGICA_TIMEOUT_MS),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SuperlogicaError(
      String(res.status),
      `resposta não-JSON (${stripHtml(text).slice(0, 120)})`,
      endpoint,
    );
  }
  return unwrapWriteResponse<T>(json, endpoint, res.status);
}

/**
 * POST form-urlencoded na API Imobiliárias — o formato que o assistente
 * "Nova venda" usa (`vendas/put`, `vendas/post`, `vendas/lancardespesa`).
 */
export async function slPostForm<T = Record<string, unknown>>(
  creds: SuperlogicaCredentials,
  resource: string,
  fields: FormFields,
): Promise<{ data: T; msg: string }> {
  const base = creds.baseUrl ?? SUPERLOGICA_BASE_URL;
  return writeRequest<T>(
    creds,
    `${base}${resource}`,
    resource,
    "POST",
    encodeForm(fields),
    "application/x-www-form-urlencoded",
  );
}

/** POST JSON na API Imobiliárias (`proprietarios`, `corretores`, `imoveis` aceitam JSON). */
export async function slPostJson<T = Record<string, unknown>>(
  creds: SuperlogicaCredentials,
  resource: string,
  body: FormFields,
): Promise<{ data: T; msg: string }> {
  const base = creds.baseUrl ?? SUPERLOGICA_BASE_URL;
  return writeRequest<T>(
    creds,
    `${base}${resource}`,
    resource,
    "POST",
    JSON.stringify(body),
    "application/json",
  );
}

/**
 * Escrita na API Financeiro v2 (form-urlencoded; POST cria, PUT altera/
 * invalida, DELETE exclui — o id vai no CORPO, não na URL: `caixa?id=`
 * responde "Lançamento não encontrado").
 */
export async function slWriteV2<T = Record<string, unknown>>(
  creds: SuperlogicaCredentials,
  method: "POST" | "PUT" | "DELETE",
  resource: string,
  fields: FormFields,
): Promise<{ data: T; msg: string }> {
  return writeRequest<T>(
    creds,
    `${SUPERLOGICA_V2_BASE_URL}${resource}`,
    `v2/${resource}`,
    method,
    encodeForm(fields),
    "application/x-www-form-urlencoded",
  );
}
