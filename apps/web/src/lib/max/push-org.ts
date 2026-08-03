import { signedBody } from "@/lib/max/hmac";
import { maxServiceUrl } from "@/lib/max/endpoint";

/**
 * Entrega do acesso de um tenant ao serviço do Max.
 *
 * É a última perna do provisionamento automático: `provisionMaxForOrg` cria
 * usuário de serviço, membership e token; isto leva o token até o `org_config`
 * do Max. Sem esta perna, ligar a feature no painel deixaria o tenant "ligado"
 * do lado de cá e mudo do lado de lá — que é o pior estado, porque
 * `/admin/max` mostraria a org como roteada.
 *
 * Usa o MESMO HMAC do `/notify`: um segredo compartilhado a menos, e o formato
 * está travado por vetor fixo nos dois repos.
 */

const NOTIFY_URL = process.env.MAX_NOTIFY_URL;
const NOTIFY_SECRET = process.env.MAX_NOTIFY_SECRET;

/**
 * Mais folgado que os 3s do `/notify`: aqui há escrita com criptografia do
 * outro lado, e este caminho roda fora do request do usuário (`waitUntil`),
 * então esperar um pouco mais não custa latência a ninguém.
 */
const TIMEOUT_MS = 8000;

export type PushResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "unauthorized" | "unreachable" | "error"; detail?: string };

async function call(
  method: "POST" | "DELETE",
  payload: unknown
): Promise<PushResult> {
  if (!NOTIFY_URL || !NOTIFY_SECRET) return { ok: false, reason: "not_configured" };

  const { body, headers } = signedBody(payload, NOTIFY_SECRET);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(maxServiceUrl(NOTIFY_URL, "/api/orgs"), {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    if (res.status === 401) return { ok: false, reason: "unauthorized" };
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, reason: "error", detail: `HTTP ${res.status} ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    // Timeout NÃO conta como sucesso. Mesma postura do `/notify`: um POST
    // abortado pode ter morrido antes de gravar, e tratar como entregue
    // deixaria o tenant sem token achando que está provisionado.
    const detail =
      err instanceof Error && err.name === "AbortError"
        ? `timeout após ${TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, reason: "unreachable", detail };
  } finally {
    clearTimeout(timer);
  }
}

export function pushOrgToMax(p: {
  orgId: string;
  orgName: string;
  apiToken: string;
}): Promise<PushResult> {
  return call("POST", { ...p, active: true });
}

export function deactivateOrgInMax(orgId: string): Promise<PushResult> {
  return call("DELETE", { orgId });
}
