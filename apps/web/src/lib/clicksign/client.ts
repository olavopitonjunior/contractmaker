// Wrapper HTTP da Clicksign API v3 (JSON:API).
// Auth via query string ?access_token=TOKEN (Bearer header retorna 401 mesmo
// com token válido — confirmado em 2026-05-03 contra app.clicksign.com).

const DEFAULT_TIMEOUT_MS = 60_000;

export class ClicksignError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ClicksignError";
  }
}

// Credenciais efetivas de uma requisição. Multitenant: o chamador resolve a
// conta da org (lib/clicksign/account.ts) e passa `creds`; sem `creds`, cai no
// token global do .env (org compartilhada legada + scripts de plataforma).
export interface ClicksignCreds {
  token: string;
  baseUrl: string;
}

function envToken(): string {
  const token = process.env.CLICKSIGN_API_TOKEN;
  if (!token) {
    throw new Error(
      "CLICKSIGN_API_TOKEN não configurado. Adicione no .env para habilitar assinaturas."
    );
  }
  return token;
}

function envBaseUrl(): string {
  const url = process.env.CLICKSIGN_API_BASE_URL || "https://app.clicksign.com";
  return url.replace(/\/+$/, "");
}

function resolveCreds(creds?: ClicksignCreds): ClicksignCreds {
  if (creds) return { token: creds.token, baseUrl: creds.baseUrl.replace(/\/+$/, "") };
  return { token: envToken(), baseUrl: envBaseUrl() };
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

interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  timeoutMs?: number;
  /** Credenciais da conta ClickSign da org. Omitir → token global do .env. */
  creds?: ClicksignCreds;
}

export async function clicksignRequest<T = unknown>({
  method,
  path,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  creds,
}: RequestOptions): Promise<T> {
  const { token, baseUrl } = resolveCreds(creds);
  const rawPath = path.startsWith("/") ? path : `/${path}`;
  const sep = rawPath.includes("?") ? "&" : "?";
  const url = `${baseUrl}${rawPath}${sep}access_token=${encodeURIComponent(token)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.api+json",
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/vnd.api+json";
    payload = JSON.stringify(body);
  }

  const res = await fetchWithTimeout(
    url,
    { method, headers, body: payload },
    timeoutMs
  );
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ClicksignError(
        `Resposta não-JSON da Clicksign (HTTP ${res.status})`,
        res.status,
        text.slice(0, 500)
      );
    }
  }

  if (!res.ok) {
    const msg = extractErrorMessage(parsed) || `HTTP ${res.status}`;
    throw new ClicksignError(`Clicksign: ${msg}`, res.status, parsed);
  }
  return parsed as T;
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as { errors?: Array<{ detail?: string; title?: string }> };
  const errs = obj.errors;
  if (!Array.isArray(errs) || errs.length === 0) return null;
  return errs.map((e) => e.detail || e.title).filter(Boolean).join("; ");
}
