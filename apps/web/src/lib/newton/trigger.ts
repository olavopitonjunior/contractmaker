/**
 * Gatilho imediato do Newton para um pedido recém-criado.
 *
 * Por que via sidecar `/agents/:id/run`: é o runtime real do Newton em produção
 * (mesmo loop usado no WhatsApp), já com as tools/MCP do Contractmaker wired.
 * Disparar um turn aqui faz o Newton ler o pedido (`list_newton_requests`),
 * cobrar via `whatsapp_send` e agendar lembretes (`schedule_proactive_message`)
 * na hora. NÃO usamos cron one-shot porque o web (Vercel) não roda dentro do
 * container do gateway e o caminho `docker exec` do sidecar está inativo.
 *
 * Fire-and-forget: o POST do pedido nunca falha por causa do trigger. Se o
 * sidecar estiver fora do ar, o pedido fica `open` e o cron de sweep (criado no
 * deploy) é a rede de segurança.
 */

const SIDECAR_URL = process.env.NEWTON_SIDECAR_URL;
const SIDECAR_TOKEN = process.env.NEWTON_SIDECAR_TOKEN;
const AGENT_ID = process.env.NEWTON_AGENT_ID ?? "main";
// Telefone "sistema" usado como caller do turn de gatilho. Precisa existir no
// registry de contatos do Newton com role que permita escrita (admin/operador).
const TRIGGER_PHONE = process.env.NEWTON_TRIGGER_PHONE ?? "5511999063228";

const TRIGGER_TIMEOUT_MS = 2500;

export interface TriggerArgs {
  dealId: string;
  requestId: string;
  ask: string;
  targetLabel?: string | null;
  targetRef?: string | null;
  targetType: string;
  /** "create" dispara cobrança; "cancel" pede pro Newton derrubar os lembretes. */
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
    `[deal-request · sistema] Novo pedido da negociadora no negócio ${a.dealId}. ` +
    `Leia o pedido com list_newton_requests({dealId:"${a.dealId}", status:"open"}) — ` +
    `pedido #${a.requestId}: "${a.ask}". Cobre essa informação de ${alvo} via WhatsApp ` +
    `(respeitando sigilo em grupo) e, se fizer sentido, agende lembretes. Marque o ` +
    `andamento com update_newton_request. Não trate isto como mensagem pessoal do operador.`
  );
}

/**
 * Dispara o turn no Newton. Resolve sempre (nunca lança) — o caller não deve
 * esperar nem depender do resultado.
 */
export async function triggerNewtonForRequest(a: TriggerArgs): Promise<void> {
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
