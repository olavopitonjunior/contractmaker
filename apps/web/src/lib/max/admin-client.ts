import { createHmac } from "node:crypto";

/**
 * Leitura do estado do serviço do Max, para o Mission Control do admin.
 *
 * O Newton tem painel próprio (`agentpro.ia.br`) porque o OpenClaw traz um. O
 * Max não traz nada — e construir um segundo painel, com login próprio, para
 * três tenants seria mais superfície pra manter e mais um lugar pra esquecer de
 * olhar. Então o painel dele vive aqui, e o serviço só expõe este endpoint.
 *
 * Autentica com o MESMO HMAC do `/notify`: um segredo compartilhado a menos.
 * Em GET o corpo é vazio, mas o timestamp continua limitando por quanto tempo
 * uma requisição capturada vale.
 */

const NOTIFY_URL = process.env.MAX_NOTIFY_URL;
const NOTIFY_SECRET = process.env.MAX_NOTIFY_SECRET;

/** Curto de propósito: é uma tela, e ninguém fica esperando um painel travado. */
const TIMEOUT_MS = 5000;

export interface MaxOutboxRow {
  id: string;
  org_id: string;
  audience: string;
  title: string;
  status: string;
  deliver_after: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface MaxStatus {
  service: string;
  zapi: { connected: boolean; session?: string; error?: string };
  window: { open: boolean; nextDelivery: string };
  outbox: {
    last7d: Record<string, number>;
    pending: number;
    failed: number;
    recent: MaxOutboxRow[];
  };
}

export type MaxStatusResult =
  | { ok: true; status: MaxStatus }
  | { ok: false; reason: "not_configured" | "unreachable" | "unauthorized" | "error"; detail?: string };

export async function fetchMaxStatus(orgId?: string): Promise<MaxStatusResult> {
  if (!NOTIFY_URL || !NOTIFY_SECRET) {
    return { ok: false, reason: "not_configured" };
  }

  const timestamp = String(Date.now());
  const signature = createHmac("sha256", NOTIFY_SECRET)
    .update(`${timestamp}.`)
    .digest("hex");

  const url = new URL("/api/admin/status", NOTIFY_URL.replace(/\/+$/, ""));
  if (orgId) url.searchParams.set("orgId", orgId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "X-Max-Timestamp": timestamp,
        "X-Max-Signature": signature,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 401) return { ok: false, reason: "unauthorized" };
    if (!res.ok) {
      return {
        ok: false,
        reason: "error",
        detail: `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: (await res.json()) as MaxStatus };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Serviço fora do ar é estado NORMAL enquanto o Max não subiu — a tela
    // mostra isso, não um erro de aplicação.
    return { ok: false, reason: "unreachable", detail };
  } finally {
    clearTimeout(timer);
  }
}
