/**
 * Cliente HTTP da API Ficha Certa Digital.
 *
 * Autenticação: headers `login` + `password` em TODA chamada (sem token, sem
 * OAuth). As credenciais vêm de `FichaCertaCreds` (conta da org) — nunca de
 * env. Erros da API vêm como `{ message }` em PT-BR com 401/403/404/405/422/500;
 * o cliente devolve `FichaCertaError { status, body }` e o executor decide o
 * estado rico. Mesma política de retry do Serasa/Infosimples: 1 retry em 5xx,
 * nenhum em 4xx.
 *
 * Nada aqui persiste nem loga credencial: `sanitizeForPayload` é o que vai ao
 * `CertidaoJob.requestPayload`.
 */

import type {
  ApplicantCreateBody,
  ApplicantUpdateBody,
  CreatedResponse,
  CreditsResponse,
  ReportResponse,
  SolicitationCreateBody,
  SolicitationDetail,
  WebhookConfigBody,
  WebhookConfigRow,
} from "./types";
import { FichaCertaError } from "./types";
import type { FichaCertaCreds } from "./account";

const DEFAULT_TIMEOUT_MS = 60_000;

export interface CallOptions {
  timeoutMs?: number;
  /** Default true: 1 retry em 5xx. */
  retryOn5xx?: boolean;
  /** Resposta binária (PDF) — devolve Buffer em vez de JSON. */
  binary?: boolean;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(creds: FichaCertaCreds): Record<string, string> {
  return {
    login: creds.login,
    password: creds.password,
    Accept: "application/json",
  };
}

function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  return fallback;
}

/**
 * Chamada genérica. `path` relativo ao baseUrl (ex.: `solicitation/220/report`).
 */
export async function callFichaCerta<T = unknown>(
  creds: FichaCertaCreds,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  options: CallOptions = {}
): Promise<{ status: number; body: T }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOn5xx = options.retryOn5xx !== false;
  const url = `${creds.baseUrl}/${path.replace(/^\/+/, "")}`;
  const init: RequestInit = {
    method,
    headers: {
      ...authHeaders(creds),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(url, init, timeoutMs);
    if (res.status >= 500 && retryOn5xx) res = await fetchWithTimeout(url, init, timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new FichaCertaError(`Ficha Certa indisponível (${msg})`, 0, null);
  }

  if (options.binary) {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new FichaCertaError(
        `Ficha Certa HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`,
        res.status,
        text.slice(0, 500)
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: buf as unknown as T };
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (res.ok) {
        // Algumas rotas (print) devolvem uma string JSON; outras texto puro.
        parsed = text;
      } else {
        throw new FichaCertaError(
          `Resposta Ficha Certa não-JSON (HTTP ${res.status})`,
          res.status,
          text.slice(0, 500)
        );
      }
    }
  }
  if (!res.ok) {
    throw new FichaCertaError(
      `Ficha Certa HTTP ${res.status}: ${messageOf(parsed, res.statusText)}`,
      res.status,
      parsed
    );
  }
  return { status: res.status, body: parsed as T };
}

// ---- Wrappers -----------------------------------------------------------------

export async function createSolicitation(
  creds: FichaCertaCreds,
  body: SolicitationCreateBody
): Promise<CreatedResponse> {
  return (await callFichaCerta<CreatedResponse>(creds, "POST", "solicitation/", body)).body;
}

export async function getSolicitation(
  creds: FichaCertaCreds,
  solicitationId: number | string
): Promise<SolicitationDetail> {
  return (await callFichaCerta<SolicitationDetail>(creds, "GET", `solicitation/${solicitationId}`)).body;
}

export async function deleteSolicitation(
  creds: FichaCertaCreds,
  solicitationId: number | string
): Promise<void> {
  await callFichaCerta(creds, "DELETE", `solicitation/${solicitationId}`);
}

export async function addApplicant(
  creds: FichaCertaCreds,
  solicitationId: number | string,
  body: ApplicantCreateBody
): Promise<CreatedResponse> {
  return (
    await callFichaCerta<CreatedResponse>(creds, "POST", `solicitation/${solicitationId}/applicant/`, body)
  ).body;
}

export async function updateApplicant(
  creds: FichaCertaCreds,
  solicitationId: number | string,
  applicantId: number | string,
  body: ApplicantUpdateBody
): Promise<void> {
  await callFichaCerta(creds, "PUT", `solicitation/${solicitationId}/applicant/${applicantId}`, body);
}

export async function deleteApplicant(
  creds: FichaCertaCreds,
  solicitationId: number | string,
  applicantId: number | string
): Promise<void> {
  await callFichaCerta(creds, "DELETE", `solicitation/${solicitationId}/applicant/${applicantId}`);
}

/** Enfileira o laudo dos pretendentes INCLUIDO/REINCLUIDO. Resultado só pelo webhook. */
export async function requestReport(
  creds: FichaCertaCreds,
  solicitationId: number | string
): Promise<{ message?: string }> {
  return (
    await callFichaCerta<{ message?: string }>(creds, "POST", `solicitation/${solicitationId}/report`, {})
  ).body;
}

/** Reprocessa os pretendentes EDITADO (grátis, até 50×). */
export async function reprocessReport(
  creds: FichaCertaCreds,
  solicitationId: number | string
): Promise<{ message?: string }> {
  return (
    await callFichaCerta<{ message?: string }>(creds, "PUT", `solicitation/${solicitationId}/report`)
  ).body;
}

export async function getReport(
  creds: FichaCertaCreds,
  solicitationId: number | string
): Promise<ReportResponse> {
  return (await callFichaCerta<ReportResponse>(creds, "GET", `solicitation/${solicitationId}/report`)).body;
}

export async function downloadReportPdf(
  creds: FichaCertaCreds,
  solicitationId: number | string,
  opts: { resumido?: boolean } = {}
): Promise<Buffer> {
  const qs = opts.resumido ? "?resumido=true" : "";
  return (
    await callFichaCerta<Buffer>(
      creds,
      "GET",
      `solicitation/${solicitationId}/report/download${qs}`,
      undefined,
      { binary: true, timeoutMs: 120_000 }
    )
  ).body;
}

export async function getCredits(creds: FichaCertaCreds): Promise<number> {
  const r = await callFichaCerta<CreditsResponse>(creds, "GET", "solicitation/credits");
  const n = r.body?.data?.credito_disponivel;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export async function registerWebhook(
  creds: FichaCertaCreds,
  body: WebhookConfigBody
): Promise<CreatedResponse> {
  return (await callFichaCerta<CreatedResponse>(creds, "POST", "solicitation/report/webhook", body)).body;
}

export async function listWebhooks(creds: FichaCertaCreds): Promise<WebhookConfigRow[]> {
  const r = await callFichaCerta<WebhookConfigRow[] | unknown>(creds, "GET", "solicitation/report/webhook");
  return Array.isArray(r.body) ? (r.body as WebhookConfigRow[]) : [];
}

export async function deleteWebhook(creds: FichaCertaCreds, webhookId: number | string): Promise<void> {
  await callFichaCerta(creds, "DELETE", `solicitation/report/webhook/${webhookId}`);
}

/** Healthcheck: credencial válida ⇔ `GET /credits` responde. */
export async function pingFichaCerta(creds: FichaCertaCreds): Promise<{ ok: true; credits: number }> {
  return { ok: true, credits: await getCredits(creds) };
}

/**
 * O que pode ir ao `CertidaoJob.requestPayload`: o corpo enviado, sem nada de
 * credencial (as credenciais nunca entram no corpo — vão só nos headers — mas
 * a função existe para deixar o invariante explícito no call-site).
 */
export function sanitizeForPayload<T extends Record<string, unknown>>(body: T): T {
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  delete clone.login;
  delete clone.password;
  return clone as T;
}
