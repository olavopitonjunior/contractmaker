/**
 * Abstração de envio de email.
 *
 * Provider default: Resend (EMAIL_PROVIDER=resend). Fallback: log-only em dev.
 *
 * Para enviar emails: chame `sendEmail({to, subject, react})` passando um
 * componente React (templates em ./templates/*).
 */

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  react?: React.ReactElement;
  html?: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export interface SendEmailResult {
  id: string | null;
  ok: boolean;
  error?: string;
}

function getFrom(): string {
  return process.env.EMAIL_FROM ?? "no-reply@contractmaker.local";
}

function getReplyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO;
}

async function sendViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY ausente — email não enviado");
    return { id: null, ok: false, error: "RESEND_API_KEY missing" };
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      react: input.react,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo ?? getReplyTo(),
      tags: input.tags,
    } as any);
    if (error) {
      console.error("[email] Resend error", error);
      return { id: null, ok: false, error: error.message };
    }
    return { id: data?.id ?? null, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] send failed", msg);
    return { id: null, ok: false, error: msg };
  }
}

function logOnly(input: SendEmailInput): SendEmailResult {
  console.log("[email:dev] subject=%s to=%s", input.subject, input.to);
  return { id: "dev-log", ok: true };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const provider = process.env.EMAIL_PROVIDER ?? "resend";

  if (provider === "resend") return sendViaResend(input);

  // ses, smtp: placeholders — implementar on-demand
  console.warn(`[email] provider "${provider}" não implementado, usando log-only`);
  return logOnly(input);
}
