import type { InfosimplesResponse } from "./types";

const BASE_URL = "https://api.infosimples.com/api/v2/consultas";
// IMPORTANTE: este timeout DEVE ser maior que o parametro `timeout` enviado no
// body da request (600s = 10min). Se for menor, nosso AbortController mata o
// fetch antes da Infosimples responder, mas a chamada ja foi cobrada e o job
// fica orfao em "fetching" ate o dead-man sweeper encontrar.
const DEFAULT_TIMEOUT_MS = 630_000; // 10min30s

export class InfosimplesError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "InfosimplesError";
  }
}

function getToken(): string {
  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token) {
    throw new Error(
      "INFOSIMPLES_TOKEN nao configurado. Adicione no .env para habilitar certidoes."
    );
  }
  return token;
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

export interface CallOptions {
  timeoutMs?: number;
  retryOnNetworkError?: boolean;
}

/**
 * Calls an Infosimples endpoint. Returns the parsed JSON body on both success
 * and business errors (code 6xx). Throws InfosimplesError only on network/5xx
 * or when the response is not JSON.
 */
export async function callInfosimples(
  endpoint: string,
  args: Record<string, unknown>,
  options: CallOptions = {}
): Promise<InfosimplesResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${BASE_URL}/${endpoint.replace(/^\/+/, "")}`;
  const token = getToken();
  const body = new URLSearchParams();
  body.set("token", token);
  body.set("timeout", "600");
  // I.7 (2026-05-11) — re-injeta credenciais em endpoints TJSP/* na hora
  // da chamada. O payload gravado em CertidaoJob.requestPayload passa por
  // sanitizePayload() que REMOVE login_cpf/login_senha/pkcs12_cert/pkcs12_pass
  // para não vazar no DB/logs/audit. Sem essa re-injeção, retries (que leem
  // o payload do DB direto via runSingleJob) iam sem credenciais e
  // Infosimples retornaria 606.
  //
  // I.8 (2026-05-14) — suporte a certificado digital A1 (pkcs12) via
  // criptograma AES-256-GCM. A Infosimples NÃO aceita o .pfx base64 plain
  // (code 604 "Não foi possível decriptar os parâmetros"); a API exige que
  // tanto o cert quanto a senha sejam encriptados AES-256-GCM com a chave
  // da conta antes do envio. Os criptogramas são gerados uma única vez no
  // painel Infosimples (https://api.infosimples.com/consultas/docs/certificados)
  // e ficam fixos enquanto o cert não for renovado.
  //
  // Prioridade: pkcs12 (criptograma) > gov.br (login_cpf/login_senha).
  // pkcs12 funciona pra consulta de terceiro; gov.br pessoal pode bater em
  // "Um erro inesperado" (code 600) quando o CPF consultado não é o dono
  // da conta gov.br.
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    body.set(key, String(value));
  }
  if (endpoint.startsWith("tribunal/tjsp/")) {
    const pkcs12CertCrypt = process.env.INFOSIMPLES_PKCS12_CERT_CRYPT?.trim();
    const pkcs12PassCrypt = process.env.INFOSIMPLES_PKCS12_PASS_CRYPT?.trim();
    const govbrCpf = process.env.INFOSIMPLES_GOVBR_CPF?.trim();
    const govbrPassword = process.env.INFOSIMPLES_GOVBR_PASSWORD?.trim();
    // 2026-05-19 — toggle pra forçar CPF/Senha mesmo quando criptogramas
    // PKCS12 estão setados. Permite trocar entre Cert A1 e CPF/Senha sem
    // remover envs sensíveis. Valores aceitos: "cpf_senha" | "cert_a1" |
    // undefined (default: prioridade Cert A1 > CPF/Senha por presença).
    const authMode = process.env.INFOSIMPLES_AUTH_MODE?.trim();
    const useCert =
      authMode !== "cpf_senha" && !!pkcs12CertCrypt && !!pkcs12PassCrypt;
    if (useCert) {
      body.set("pkcs12_cert", pkcs12CertCrypt!);
      body.set("pkcs12_pass", pkcs12PassCrypt!);
    } else if (govbrCpf && govbrPassword) {
      body.set("login_cpf", govbrCpf);
      body.set("login_senha", govbrPassword);
    }
  }

  const doRequest = async () => {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      timeoutMs
    );
    const text = await res.text();
    let json: InfosimplesResponse;
    try {
      json = JSON.parse(text) as InfosimplesResponse;
    } catch {
      throw new InfosimplesError(
        `Resposta nao-JSON (HTTP ${res.status})`,
        res.status,
        undefined,
        text.slice(0, 500)
      );
    }
    if (res.status >= 500) {
      throw new InfosimplesError(
        `Infosimples HTTP ${res.status}: ${json.code_message || "erro"}`,
        res.status,
        json.code,
        json
      );
    }
    return json;
  };

  try {
    return await doRequest();
  } catch (err) {
    if (
      options.retryOnNetworkError !== false &&
      err instanceof InfosimplesError &&
      err.status >= 500
    ) {
      return await doRequest();
    }
    if (options.retryOnNetworkError !== false && err instanceof Error && err.name === "AbortError") {
      return await doRequest();
    }
    throw err;
  }
}

/**
 * Downloads a receipt PDF from the URL returned by Infosimples.
 */
export async function downloadReceipt(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetchWithTimeout(url, { method: "GET" }, 60_000);
  if (!res.ok) {
    throw new InfosimplesError(
      `Falha ao baixar comprovante (HTTP ${res.status})`,
      res.status
    );
  }
  const contentType = res.headers.get("content-type") || "application/pdf";
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

/**
 * Sanitizes a payload for DB persistence by removing the token.
 */
export function sanitizePayload(
  args: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...args };
  delete clean.token;
  delete clean.login_cpf;
  delete clean.login_senha;
  delete clean.pkcs12_cert;
  delete clean.pkcs12_pass;
  return clean;
}
