/**
 * Abstração de envio de email.
 *
 * Provider default: Resend (EMAIL_PROVIDER=resend). Fallback: log-only em dev.
 *
 * Para enviar emails: chame `sendEmail({to, subject, react})` passando um
 * componente React (templates em ./templates/*).
 */

import { STAGING_MODE } from "@/lib/env/staging";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  react?: React.ReactElement;
  html?: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

/**
 * Em staging, redireciona destinatários externos pra STAGING_EMAIL_OVERRIDE
 * (default: olavo.piton@gmail.com). Permite domínio interno whitelistado
 * via STAGING_EMAIL_OVERRIDE_DOMAIN. Loga o destinatário original.
 *
 * Em prod, no-op.
 */
function applyStagingEmailGate(to: string | string[]): {
  to: string[];
  redirected: boolean;
  original: string[];
} {
  const original = Array.isArray(to) ? to : [to];
  if (!STAGING_MODE) return { to: original, redirected: false, original };

  const override = process.env.STAGING_EMAIL_OVERRIDE;
  if (!override) {
    console.warn("[email:staging] STAGING_MODE=true mas STAGING_EMAIL_OVERRIDE ausente — bloqueando envio");
    return { to: [], redirected: true, original };
  }

  const whitelistDomain = process.env.STAGING_EMAIL_OVERRIDE_DOMAIN;
  const allowed = original.filter(
    (addr) => addr === override || (whitelistDomain && addr.endsWith(`@${whitelistDomain}`))
  );
  if (allowed.length === original.length) {
    return { to: original, redirected: false, original };
  }
  console.warn(
    "[email:staging] redirecting %j → %s (whitelistDomain=%s)",
    original,
    override,
    whitelistDomain ?? "—"
  );
  return { to: [override], redirected: true, original };
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
  const gated = applyStagingEmailGate(input.to);
  if (gated.to.length === 0) {
    return { id: "staging-blocked", ok: true };
  }
  const effective: SendEmailInput = gated.redirected
    ? {
        ...input,
        to: gated.to,
        subject: `[STAGING] ${input.subject} (originalmente: ${gated.original.join(", ")})`,
      }
    : input;

  const provider = process.env.EMAIL_PROVIDER ?? "resend";

  if (provider === "resend") return sendViaResend(effective);

  // ses, smtp: placeholders — implementar on-demand
  console.warn(`[email] provider "${provider}" não implementado, usando log-only`);
  return logOnly(effective);
}
