// Wrapper HTTP da Clicksign API v3 (JSON:API).
// Padrão Authorization: Bearer + Content-Type vnd.api+json.

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

function getToken(): string {
  const token = process.env.CLICKSIGN_API_TOKEN;
  if (!token) {
    throw new Error(
      "CLICKSIGN_API_TOKEN não configurado. Adicione no .env para habilitar assinaturas."
    );
  }
  return token;
}

function getBaseUrl(): string {
  const url = process.env.CLICKSIGN_API_BASE_URL || "https://app.clicksign.com";
  return url.replace(/\/+$/, "");
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
}

export async function clicksignRequest<T = unknown>({
  method,
  path,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RequestOptions): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
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
