import { maxServiceUrl } from "@/lib/max/endpoint";
import { signMaxAdminRequest } from "@/lib/max/hmac";

/**
 * Leitura do estado do serviço do Max, para o Mission Control do admin.
 *
 * O Newton tem painel próprio (`agentpro.ia.br`) porque o OpenClaw traz um. O
 * Max não traz nada — e construir um segundo painel, com login próprio, para
 * três tenants seria mais superfície pra manter e mais um lugar pra esquecer de
 * olhar. Então o painel dele vive aqui, e o serviço só expõe este endpoint.
 *
 * Autentica com o MESMO HMAC do `/notify`: um segredo compartilhado a menos.
 *
 * ── O que é assinado, e por que mudou ─────────────────────────────────────
 *
 * Assinava `${timestamp}.` — corpo vazio, porque em GET não há corpo. O
 * problema é que isso deixava a QUERY de fora: uma assinatura capturada valia
 * cinco minutos para **qualquer `?orgId=`**, e o painel de um tenant abria o
 * de outro. O serviço fechou essa porta assinando
 * `${timestamp}.${método}.${caminho com query}` e tolerou o formato antigo
 * enquanto este cliente não migrasse.
 *
 * Este arquivo é a migração, e a tolerância **já caiu** (max#21, 2026-08-28):
 * o `/admin/status` do max-agent recusa o formato antigo. O sunset não se
 * apoiou no log de telemetria — a rota só é chamada quando alguém abre o
 * painel, então "log zerado" media apenas que ninguém tinha olhado a tela. A
 * prova foi estática: `fetchMaxStatus` abaixo é o ÚNICO chamador da rota, e ele
 * assina o formato novo.
 */

/**
 * A assinatura vem do `lib/max/hmac.ts`, e não de um `createHmac` local.
 *
 * O cabeçalho daquele arquivo é explícito: duplicar a função cria duas chances
 * de divergir do outro repositório em vez de uma. Este cliente era citado lá
 * como usuário do módulo sem nunca ter sido — agora é de verdade.
 */
function assinar(secret: string, method: string, pathComQuery: string) {
  const timestamp = String(Date.now());
  return {
    timestamp,
    signature: signMaxAdminRequest(timestamp, method, pathComQuery, secret),
  };
}

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

  const url = maxServiceUrl(NOTIFY_URL, "/api/admin/status");
  if (orgId) url.searchParams.set("orgId", orgId);

  // Depois de montar a URL: a query entra na assinatura, então assinar antes
  // de acrescentar `orgId` devolveria 401 — e é justamente o `orgId` que a
  // assinatura precisa cobrir.
  const { timestamp, signature } = assinar(
    NOTIFY_SECRET,
    "GET",
    `${url.pathname}${url.search}`
  );

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

// ─────────────────────────────────────────────────────────────────────────
// Conversas
// ─────────────────────────────────────────────────────────────────────────

/**
 * Uma linha de `conversation_turn` do serviço.
 *
 * O telefone chega **já mascarado** — a máscara é aplicada na origem, não
 * aqui. Isso é deliberado: o número inteiro fica atrás da credencial do banco
 * do Max, e a resposta HTTP atravessa rede, log de proxy e navegador.
 */
export interface MaxConversationTurn {
  id: string;
  orgId: string;
  phone: string;
  messageId: string | null;
  kind: string;
  inboundText: string | null;
  transcript: string | null;
  replyText: string | null;
  tools: { name: string; args: Record<string, unknown>; outcome: string }[];
  usage: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens?: number;
    latencyMs: number;
    success: boolean;
  }[];
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export type MaxConversationsResult =
  | {
      ok: true;
      turns: MaxConversationTurn[];
      nextCursor: string | null;
      /** O serviço subiu antes da migration — estado transitório, não erro. */
      degraded?: string;
    }
  | {
      ok: false;
      reason: "not_configured" | "unreachable" | "unauthorized" | "error";
      detail?: string;
    };

/**
 * Conversas de UM tenant.
 *
 * `orgId` é obrigatório aqui, mesmo o serviço aceitando `scope=all`. Uma tela
 * que lê conversa de gente real não deve mostrar todos os tenants porque
 * alguém não escolheu nenhum — a visão cruzada, se um dia fizer falta, nasce
 * com o caso de uso e com a decisão de quem a pediu.
 */
export async function fetchMaxConversations(params: {
  orgId: string;
  limit?: number;
  cursor?: string | null;
}): Promise<MaxConversationsResult> {
  if (!NOTIFY_URL || !NOTIFY_SECRET) {
    return { ok: false, reason: "not_configured" };
  }

  const url = maxServiceUrl(NOTIFY_URL, "/api/admin/conversations");
  url.searchParams.set("orgId", params.orgId);
  if (params.limit) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);

  const { timestamp, signature } = assinar(
    NOTIFY_SECRET,
    "GET",
    `${url.pathname}${url.search}`
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "X-Max-Timestamp": timestamp, "X-Max-Signature": signature },
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 401) return { ok: false, reason: "unauthorized" };
    if (!res.ok) return { ok: false, reason: "error", detail: `HTTP ${res.status}` };

    const body = (await res.json()) as {
      turns: MaxConversationTurn[];
      nextCursor: string | null;
      degraded?: string;
    };
    return { ok: true, ...body };
  } catch (err) {
    // Mesmo tratamento do `fetchMaxStatus`: serviço fora do ar é estado que a
    // tela mostra, não erro de aplicação.
    return {
      ok: false,
      reason: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
