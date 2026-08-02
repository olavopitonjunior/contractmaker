/**
 * Envio de notificação do sistema pelo Max — o agente de WhatsApp dos tenants
 * RE/MAX, que roda fora deste repo (serviço LangGraph sobre a WhatsApp Cloud
 * API oficial).
 *
 * Contraste deliberado com `lib/newton/notify-trigger.ts`: lá o transporte é um
 * TURN EM LINGUAGEM NATURAL que instrui um agente a chamar `whatsapp_send`;
 * aqui é um POST estruturado, campo a campo, sem prompt no meio. Três razões:
 *
 *  1. **Template da Meta.** Fora da janela de 24h a Cloud API só aceita template
 *     com variáveis posicionais — e é esse o caso da esmagadora maioria das
 *     notificações proativas, porque a janela só abre se o destinatário falou
 *     com o Max nas últimas 24h. Um turn em prosa não mapeia pra `{{1}}`/`{{2}}`.
 *  2. **Sem superfície de injeção.** O texto do negócio deixa de ser costurado
 *     dentro de um prompt, então não há cerca `<conteudo>` a arrombar. Continua
 *     sanitizado — a Meta recusa quebra de linha em parâmetro de template.
 *  3. **Aceite de verdade.** 202 + id é resposta; o `AbortError` do Newton, que
 *     este módulo NÃO imita, era contado como envio.
 *
 * O que 202 significa: "o Max assumiu a entrega", não "o destinatário recebeu".
 * A entrega real (incluindo adiamento pra dentro da janela de cortesia 7h–22h,
 * que passa a ser responsabilidade do outbox do Max) só é conhecida pelos
 * callbacks de status da Meta, hoje visíveis apenas do lado do Max.
 *
 * Gates, na ordem: `MAX_DISABLED` global → feature por org (default OFF) → envs
 * presentes → telefone normalizável. Qualquer um fechado → "skipped".
 */

import { createHmac } from "node:crypto";
import { normalizeBrPhone } from "@/lib/validators/phone-br";
import { sanitizeUntrusted } from "@/lib/notifications/sanitize";

const NOTIFY_URL = process.env.MAX_NOTIFY_URL;
const NOTIFY_SECRET = process.env.MAX_NOTIFY_SECRET;
const MAX_DISABLED = process.env.MAX_DISABLED === "true";

/**
 * O `/notify` do Max só valida, resolve o destinatário e enfileira — responde em
 * dezenas de milissegundos. 3s cobre latência de rede pro VPS com folga; passar
 * disso é sintoma, não lentidão normal.
 */
const NOTIFY_TIMEOUT_MS = 3000;

export type MaxNotifyAudience = "platform_user" | "deal_broker" | "deal_party";

export interface MaxNotifyArgs {
  orgId: string;
  audience: MaxNotifyAudience;
  /** Telefone em formato livre (cadastro do corretor ou User.phone) — normalizado aqui. */
  phone: string;
  recipientName: string;
  /** Título curto do evento. Vira `{{2}}` no template. */
  title: string;
  /** Corpo da atualização. Vira `{{3}}` no template. */
  body: string;
  /** Link do recurso; o Max encurta via redirector próprio (o host varia por tenant). */
  linkUrl?: string | null;
  dealId?: string | null;
  /**
   * Nome da imobiliária — obrigatório: um número único do Max atende os três
   * tenants RE/MAX, então sem isso o destinatário não sabe de qual org veio.
   */
  orgName: string;
  /**
   * Chave de idempotência ponta a ponta. É a MESMA dos trilhos de notificação
   * (id da linha de log / da entrega), então um reenvio acidental colide no Max
   * e devolve 409 em vez de mandar a mensagem duas vezes.
   */
  dedupeKey: string;
}

export type MaxNotifyResult =
  | { status: "sent"; id: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

function sign(timestamp: string, rawBody: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export async function triggerMaxNotify(
  a: MaxNotifyArgs
): Promise<MaxNotifyResult> {
  if (MAX_DISABLED) return { status: "skipped", reason: "max_disabled" };

  const { isMaxEnabledForOrg } = await import("@/lib/max/gate");
  if (!(await isMaxEnabledForOrg(a.orgId).catch(() => false))) {
    return { status: "skipped", reason: "max_off_para_a_org" };
  }

  if (!NOTIFY_URL || !NOTIFY_SECRET) {
    console.warn("[max-notify] MAX_NOTIFY_URL/SECRET ausentes — WhatsApp pulado");
    return { status: "skipped", reason: "max_service_ausente" };
  }

  // O Max normaliza de novo do lado dele, mas telefone inválido não deve nem
  // sair daqui: assim o motivo fica no log do negócio, onde alguém procura.
  const e164 = normalizeBrPhone(a.phone);
  if (!e164) {
    console.warn(`[max-notify] telefone inválido (${a.phone}) — WhatsApp pulado`);
    return { status: "skipped", reason: "telefone_invalido" };
  }

  const rawBody = JSON.stringify({
    orgId: a.orgId,
    audience: a.audience,
    phone: e164,
    recipientName: sanitizeUntrusted(a.recipientName, 120),
    title: sanitizeUntrusted(a.title, 120),
    body: sanitizeUntrusted(a.body, 600),
    linkUrl: a.linkUrl ? sanitizeUntrusted(a.linkUrl, 300) : null,
    dealId: a.dealId ?? null,
    orgName: sanitizeUntrusted(a.orgName, 120),
    dedupeKey: a.dedupeKey,
  });

  const timestamp = String(Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);

  try {
    const res = await fetch(`${NOTIFY_URL.replace(/\/+$/, "")}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Max-Timestamp": timestamp,
        "X-Max-Signature": sign(timestamp, rawBody, NOTIFY_SECRET),
      },
      body: rawBody,
      signal: controller.signal,
    });

    // 409 = o Max já tem esta dedupeKey. Não é erro: é a idempotência
    // funcionando, e reportar "sent" mantém o log do negócio coerente com o
    // que o destinatário de fato viu (uma mensagem só).
    if (res.status === 409) return { status: "sent", id: null };

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        status: "failed",
        error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }

    const payload = (await res.json().catch(() => null)) as {
      id?: string;
    } | null;
    return { status: "sent", id: payload?.id ?? null };
  } catch (err) {
    // Ao contrário do Newton, timeout aqui NÃO conta como envio: o turn do
    // sidecar seguia server-side depois do abort, mas um POST abortado pode
    // ter morrido antes de enfileirar. `failed` com o motivo é a leitura
    // honesta — e a dedupeKey torna um reenvio manual seguro.
    const error =
      err instanceof Error && err.name === "AbortError"
        ? `timeout após ${NOTIFY_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[max-notify] falhou:", error);
    return { status: "failed", error };
  } finally {
    clearTimeout(timer);
  }
}
