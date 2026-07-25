import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import { SurveyInviteEmail } from "@/lib/email/templates/survey-invite";
import { isNewtonEnabledForDeal } from "@/lib/newton/gate";
import { isWithinWhatsappWindow } from "@/lib/newton/whatsapp-window";
import { appendEvent } from "@/lib/newton/requests";
import { triggerNewtonForRequest } from "@/lib/newton/trigger";
import { normalizeBrPhone } from "@/lib/validators/phone-br";

/**
 * Camada de canal do envio de pesquisa.
 *
 * - `email`: envio direto via sendEmail.
 * - `whatsapp`: mensagem proativa via agente Newton (NewtonRequest + trigger,
 *   padrão dos executores de locação) com FALLBACK AUTOMÁTICO pra email quando
 *   o WhatsApp não é viável (Newton OFF, sem deal, telefone inválido) — decisão
 *   de produto: maximizar entrega.
 * - `manual`: só cria o invite; o link é copiado da UI.
 */

export function surveyUrl(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  return `${base.replace(/\/$/, "")}/s/${token}`;
}

export function surveyOptoutUrl(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  return `${base.replace(/\/$/, "")}/api/public/surveys/${token}/optout`;
}

/**
 * Telefone no formato do `whatsapp_send`/`NewtonRequest.targetRef`: E.164 SEM
 * `+` e COM DDI 55 (`5511987654321`). O `recipientPhone` do invite guarda só
 * dígitos sem DDI (normalizePhone de recipients.ts) — a conversão vive aqui.
 * null = sem WhatsApp viável (dispara o fallback email).
 */
export function whatsappTargetPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e164 = normalizeBrPhone(raw);
  return e164 ? e164.replace(/^\+/, "") : null;
}

export interface SendInviteArgs {
  invite: {
    id: string;
    token: string;
    channel: string;
    recipientName: string | null;
    recipientEmail: string | null;
    recipientPhone: string | null;
    remindersSent?: number;
  };
  templateName: string;
  orgId: string;
  /** Contexto do deal — exigido pelo canal whatsapp (NewtonRequest é ancorado
   *  em Deal e createdBy é FK de User). Ausente → fallback email. */
  deal?: { id: string; kind: string; userId: string } | null;
  isReminder?: boolean;
}

export type SendInviteResult =
  | { ok: true; channel: "email"; fellBack?: boolean }
  | { ok: true; channel: "whatsapp"; newtonRequestId: string }
  | { ok: true; channel: "manual" }
  // deferred: fora da janela 7h-22h SP — invite fica pending e o cron de
  // dispatch (15min) reenvia quando a janela abrir. NÃO cai pra email.
  | { ok: false; reason: string; deferred?: boolean };

/**
 * Janela de horário comercial do WhatsApp (7h-22h America/Sao_Paulo) — mudou
 * de casa pra lib/newton/whatsapp-window.ts quando o canal de notificação ao
 * usuário passou a precisar da mesma regra. Re-exportado aqui porque é o
 * import histórico (channels.test.ts e o cron de dispatch).
 */
export { isWithinWhatsappWindow };

/**
 * Envia (ou reenvia) um invite pelo canal dele e atualiza o status. Nunca
 * lança: falha do ENVIO inicial marca `status="failed"` (o cron de
 * reconciliação re-tenta); falha de REMINDER não rebaixa o invite.
 */
export async function sendSurveyInvite(
  args: SendInviteArgs
): Promise<SendInviteResult> {
  const { invite, templateName, orgId, deal, isReminder } = args;

  if (invite.channel === "manual") {
    // Link copiável — nada a enviar; deixa de ser "pending" pra régua não pegar.
    await prisma.surveyInvite.update({
      where: { id: invite.id },
      data: { status: "sent", sentAt: new Date() },
    });
    return { ok: true, channel: "manual" };
  }

  if (invite.channel === "whatsapp") {
    const result = await sendViaWhatsapp(args);
    if (result.ok) return result;
    // Fora da janela NÃO é falha nem fallback: o invite segue pending/sent e
    // o cron re-tenta dentro da janela.
    if (result.deferred) return result;
    // Fallback automático pra email (decisão de produto). Sem email → falha.
    if (invite.recipientEmail) {
      const emailResult = await sendViaEmail(args);
      return emailResult.ok
        ? { ok: true, channel: "email", fellBack: true }
        : emailResult;
    }
    if (!isReminder) {
      await prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { status: "failed" },
      });
    }
    return result;
  }

  return sendViaEmail(args);
}

async function sendViaEmail(args: SendInviteArgs): Promise<SendInviteResult> {
  const { invite, templateName, orgId, isReminder } = args;

  if (!invite.recipientEmail) {
    if (!isReminder) {
      await prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { status: "failed" },
      });
    }
    return { ok: false, reason: "sem e-mail do destinatário" };
  }

  const result = await sendEmail({
    to: invite.recipientEmail,
    subject: isReminder ? `Lembrete: ${templateName}` : templateName,
    react: SurveyInviteEmail({
      recipientName: invite.recipientName ?? "",
      surveyName: templateName,
      surveyUrl: surveyUrl(invite.token),
      optoutUrl: surveyOptoutUrl(invite.token),
      isReminder,
    }),
    orgId,
  });

  if (!result.ok) {
    // Envio inicial falho → "failed" (retry no sweep). Reminder falho mantém
    // "sent" — o cron de reminders tenta de novo no dia seguinte.
    if (!isReminder) {
      await prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { status: "failed" },
      });
    }
    return { ok: false, reason: result.error ?? "falha no envio de e-mail" };
  }

  await markSent(args);
  return { ok: true, channel: "email" };
}

/**
 * WhatsApp via Newton: cria um NewtonRequest one-shot (o `ask` instrui o agente
 * a mandar UMA mensagem e marcar fulfilled — sem re-cobrança; a régua de
 * lembretes é 100% nossa, cada lembrete vira um pedido novo) e cutuca o
 * sidecar. Sem confirmação de entrega do WhatsApp — o rastreio é o próprio
 * SurveyInvite (respondeu = link chegou).
 */
async function sendViaWhatsapp(args: SendInviteArgs): Promise<SendInviteResult> {
  const { invite, templateName, orgId, deal, isReminder } = args;

  if (!deal?.id || !deal.userId) {
    return { ok: false, reason: "whatsapp requer negócio vinculado" };
  }

  const enabled = await isNewtonEnabledForDeal(orgId, deal.kind).catch(() => false);
  if (!enabled) {
    return { ok: false, reason: "agente Newton desabilitado pra org" };
  }

  const phone = whatsappTargetPhone(invite.recipientPhone);
  if (!phone) {
    return { ok: false, reason: "telefone inválido pra WhatsApp" };
  }

  // Depois das checagens de viabilidade (inviável cai pra email na hora);
  // viável fora da janela espera o cron — não é falha.
  if (!isWithinWhatsappWindow()) {
    return {
      ok: false,
      deferred: true,
      reason: "fora da janela 7h–22h — envio automático quando a janela abrir",
    };
  }

  const attempt = (invite.remindersSent ?? 0) + 1;
  const tag = isReminder
    ? `[survey_reminder][${invite.id}][${attempt}]`
    : `[survey_invite][${invite.id}]`;
  const firstName = (invite.recipientName ?? "").trim().split(/\s+/)[0] || "o cliente";
  const link = surveyUrl(invite.token);
  const ask = isReminder
    ? `${tag} Lembrete de pesquisa de satisfação: envie UMA única mensagem curta e cordial a ${firstName} lembrando da pesquisa "${templateName}" com o link ${link}. Não insista além desta mensagem e marque este pedido como fulfilled imediatamente após enviar.`
    : `${tag} Pesquisa de satisfação: envie UMA única mensagem cordial a ${firstName} convidando a responder a pesquisa "${templateName}" pelo link ${link} (leva menos de 2 minutos). Não insista, não re-cobre; marque este pedido como fulfilled imediatamente após enviar.`;

  // Dedupe ATÔMICO por tag: unique no banco (NewtonRequest.dedupeTag) —
  // corrida entre cron de retry e "Reenviar" manual nunca cria dois pedidos
  // (nem duas mensagens de WhatsApp) pro mesmo invite/tentativa.
  let requestId: string;
  try {
    const created = await prisma.newtonRequest.create({
      data: {
        orgId,
        dealId: deal.id,
        createdBy: deal.userId,
        ask,
        dedupeTag: tag,
        targetType: "contact",
        targetRef: phone,
        targetLabel: invite.recipientName,
        status: "open",
        priority: "normal",
        eventsJson: appendEvent(null, {
          actor: "sistema",
          type: isReminder ? "survey_reminder_triggered" : "survey_invite_triggered",
          note: invite.id,
        }),
      },
      select: { id: true },
    });
    requestId = created.id;
  } catch (e) {
    if ((e as { code?: string })?.code !== "P2002") throw e;
    const existing = await prisma.newtonRequest.findUnique({
      where: { dedupeTag: tag },
      select: { id: true },
    });
    if (!existing) {
      return { ok: false, reason: "corrida no dedupe do pedido Newton" };
    }
    requestId = existing.id;
  }

  // Fire-and-forget interno (nunca lança); sem sidecar configurado o sweep de
  // NewtonRequests cobre o disparo.
  await triggerNewtonForRequest({
    orgId,
    dealId: deal.id,
    requestId,
    ask,
    targetType: "contact",
    targetRef: phone,
    targetLabel: invite.recipientName,
    kind: "create",
  });

  await markSent(args);
  return { ok: true, channel: "whatsapp", newtonRequestId: requestId };
}

async function markSent(args: SendInviteArgs): Promise<void> {
  const { invite, isReminder } = args;
  await prisma.surveyInvite.update({
    where: { id: invite.id },
    data: isReminder
      ? {
          // increment atômico — leitura+escrita separada duplicaria contagem
          // sob concorrência (cron de reminders × retry de failed).
          remindersSent: { increment: 1 },
          lastReminderAt: new Date(),
        }
      : { status: "sent", sentAt: new Date() },
  });
}
