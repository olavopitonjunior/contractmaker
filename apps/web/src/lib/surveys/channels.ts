import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import { SurveyInviteEmail } from "@/lib/email/templates/survey-invite";
import { isNewtonEnabledForOrg } from "@/lib/newton/gate";

/**
 * Camada de canal do envio de pesquisa. `email` envia agora; `whatsapp` é um
 * stub fail-soft pronto pra integração com o Newton/Max (único ponto a
 * implementar quando o produto ativar — mesma interface); `manual` só cria o
 * invite e o link é copiado da UI.
 */

export function surveyUrl(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  return `${base.replace(/\/$/, "")}/s/${token}`;
}

export function surveyOptoutUrl(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  return `${base.replace(/\/$/, "")}/api/public/surveys/${token}/optout`;
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
  isReminder?: boolean;
}

export type SendInviteResult =
  | { ok: true; channel: "email" }
  | { ok: true; channel: "manual" }
  | { ok: false; reason: string };

/**
 * Envia (ou reenvia) um invite pelo canal dele e atualiza o status. Nunca
 * lança: falha de envio marca `status="failed"` (o cron de reconciliação
 * re-tenta no próximo sweep).
 */
export async function sendSurveyInvite(
  args: SendInviteArgs
): Promise<SendInviteResult> {
  const { invite, templateName, orgId, isReminder } = args;

  if (invite.channel === "manual") {
    // Link copiável — nada a enviar; deixa de ser "pending" pra régua não pegar.
    await prisma.surveyInvite.update({
      where: { id: invite.id },
      data: { status: "sent", sentAt: new Date() },
    });
    return { ok: true, channel: "manual" };
  }

  if (invite.channel === "whatsapp") {
    // Stub Newton/Max: gate por tenant + retorno fail-soft. Quando a integração
    // for ativada, este braço cria o NewtonRequest e chama triggerNewtonForRequest
    // (lib/newton/trigger.ts) — o restante do fluxo não muda.
    const enabled = await isNewtonEnabledForOrg(orgId).catch(() => false);
    return {
      ok: false,
      reason: enabled
        ? "whatsapp_not_available: integração Newton pendente"
        : "whatsapp_not_available: Newton desabilitado pra org",
    };
  }

  if (!invite.recipientEmail) {
    await prisma.surveyInvite.update({
      where: { id: invite.id },
      data: { status: "failed" },
    });
    return { ok: false, reason: "sem e-mail do destinatário" };
  }

  const result = await sendEmail({
    to: invite.recipientEmail,
    subject: isReminder
      ? `Lembrete: ${templateName}`
      : templateName,
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
    // Falha no ENVIO inicial → "failed" (o cron de reconciliação re-tenta).
    // Falha num REMINDER não rebaixa o invite: ele continua "sent" e o cron
    // de reminders tenta de novo no dia seguinte.
    if (!isReminder) {
      await prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { status: "failed" },
      });
    }
    return { ok: false, reason: result.error ?? "falha no envio de e-mail" };
  }

  await prisma.surveyInvite.update({
    where: { id: invite.id },
    data: isReminder
      ? {
          remindersSent: (invite.remindersSent ?? 0) + 1,
          lastReminderAt: new Date(),
        }
      : { status: "sent", sentAt: new Date() },
  });
  return { ok: true, channel: "email" };
}
