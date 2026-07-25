/**
 * Notificação do processo → corretor, por WhatsApp via sidecar Newton.
 *
 * O transporte (gates, timeout, payload, sanitização, cerca <conteudo>) mudou
 * de casa pra lib/newton/notify-trigger.ts quando o canal de notificação ao
 * USUÁRIO da plataforma passou a precisar do mesmo caminho. Este módulo
 * continua sendo o import de lib/notifications/deal-events.ts — a audiência
 * `deal_broker` preserva o texto original do turn (tag `[deal-notify ·
 * sistema]`, "não espere resposta"), porque o corretor comissionado pode não
 * ser usuário da plataforma.
 */

import {
  triggerNewtonNotify,
  type NewtonNotifyArgs,
} from "@/lib/newton/notify-trigger";

export interface DealNotifyTriggerArgs {
  orgId: string;
  dealId: string;
  /** Telefone do corretor (formato livre do cadastro — o agente normaliza). */
  phone: string;
  recipientName: string;
  /** Mensagem pronta em PT-BR (título + corpo da atualização). */
  message: string;
}

export async function triggerNewtonDealNotify(
  a: DealNotifyTriggerArgs
): Promise<"sent" | "skipped"> {
  const args: NewtonNotifyArgs = { ...a, audience: "deal_broker" };
  return triggerNewtonNotify(args);
}
