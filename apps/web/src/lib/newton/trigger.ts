/**
 * Gatilho de turn no Newton via sidecar `/agents/:id/run` — o runtime real do
 * agente em produção (mesmo loop do WhatsApp), já com as tools/MCP do
 * Contractmaker wired.
 *
 * Escopo desde 2026-07-25: o Newton NÃO cobra mais informação por conta própria.
 * Foram removidos o cron horário de re-cobrança (`/api/cron/newton-requests/sweep`)
 * e o disparo na criação de pedido — o inbox do deal virou registro interno.
 * Restam dois usos legítimos deste gatilho:
 *
 *  - `kind: "create"` — entrega de pesquisa de satisfação por WhatsApp
 *    (`lib/surveys/channels.ts`), one-shot por convite.
 *  - `kind: "cancel"` — derrubar lembretes que o Newton agendou no passado
 *    (`NewtonRequest.cronJobIds`), já que o web não fala com o cron do gateway.
 *
 * Fire-and-forget: o caller nunca falha por causa do trigger.
 */

const SIDECAR_URL = process.env.NEWTON_SIDECAR_URL;
const SIDECAR_TOKEN = process.env.NEWTON_SIDECAR_TOKEN;
const AGENT_ID = process.env.NEWTON_AGENT_ID ?? "main";
const NEWTON_DISABLED = process.env.NEWTON_DISABLED === "true";
// Telefone "sistema" usado como caller do turn de gatilho. Precisa existir no
// registry de contatos do Newton com role que permita escrita (admin/operador).
const TRIGGER_PHONE = process.env.NEWTON_TRIGGER_PHONE ?? "5511999063228";

const TRIGGER_TIMEOUT_MS = 2500;

export interface TriggerArgs {
  /** Org do pedido — o Newton é uma feature por tenant (default OFF). */
  orgId: string;
  dealId: string;
  requestId: string;
  ask: string;
  targetLabel?: string | null;
  targetRef?: string | null;
  targetType: string;
  /**
   * "create" dispara o envio único (hoje só pesquisas de satisfação);
   * "cancel" pede pro Newton derrubar lembretes legados.
   */
  kind?: "create" | "cancel";
}

function buildText(a: TriggerArgs): string {
  const alvo = a.targetType === "group"
    ? `o grupo do negócio${a.targetLabel ? ` (${a.targetLabel})` : ""}`
    : `o contato ${a.targetLabel ?? a.targetRef ?? "indicado"}`;

  if (a.kind === "cancel") {
    return (
      `[deal-request · sistema] A negociadora CANCELOU o pedido #${a.requestId} ` +
      `no negócio ${a.dealId}. Use list_newton_requests({dealId:"${a.dealId}"}) para ` +
      `localizá-lo e cancele os lembretes vinculados (cancel_proactive_dispatch nos ` +
      `cronJobIds). Não trate isto como mensagem pessoal do operador.`
    );
  }
  return (
    `[deal-request · sistema] Novo pedido no negócio ${a.dealId}. ` +
    `Leia o pedido com list_newton_requests({dealId:"${a.dealId}", status:"open"}) — ` +
    `pedido #${a.requestId}: "${a.ask}". Envie a mensagem para ${alvo} via WhatsApp ` +
    `(respeitando sigilo em grupo) UMA vez e feche com update_newton_request. ` +
    `Envio único: NÃO re-cobre depois e NÃO agende cron de lembrete. Não trate isto ` +
    `como mensagem pessoal do operador.`
  );
}

/**
 * Dispara o turn no Newton. Resolve sempre (nunca lança) — o caller não deve
 * esperar nem depender do resultado.
 */
export async function triggerNewtonForRequest(a: TriggerArgs): Promise<void> {
  if (NEWTON_DISABLED) {
    console.log("[newton.trigger] NEWTON_DISABLED=true — pulando dispatch (request=%s)", a.requestId);
    return;
  }
  // Chokepoint por tenant: a env acima é global (por deploy). Tenants sem o Newton
  // (default do catálogo) nunca podem cutucar o WhatsApp — nem por API, nem pelo cron
  // de sweep, nem pelos executores de locação que criam NewtonRequest como fila.
  const { isNewtonEnabledForOrg } = await import("@/lib/newton/gate");
  if (!(await isNewtonEnabledForOrg(a.orgId))) {
    console.log("[newton.trigger] Newton desabilitado na org %s — pulando dispatch", a.orgId);
    return;
  }
  if (!SIDECAR_URL || !SIDECAR_TOKEN) {
    console.warn("[newton.trigger] NEWTON_SIDECAR_URL/TOKEN ausentes — pedido fica para o sweep");
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
  try {
    await fetch(`${SIDECAR_URL}/agents/${AGENT_ID}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SIDECAR_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        caller: { phone: TRIGGER_PHONE, name: "Sistema" },
        text: buildText(a),
        // Tenant de origem. O gate `isNewtonEnabledForOrg` acima é config e pode
        // ser ligado por engano noutro tenant; mandar o orgId deixa o sidecar
        // recusar sozinho (allowlist determinística), sem depender deste flag.
        orgId: a.orgId,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    // Timeout/abort é esperado: o turn segue server-side mesmo após o abort do
    // cliente. Só logamos erros de rede reais para observabilidade.
    if (!(err instanceof Error && err.name === "AbortError")) {
      console.error("[newton.trigger] falhou:", err instanceof Error ? err.message : String(err));
    }
  } finally {
    clearTimeout(timer);
  }
}
