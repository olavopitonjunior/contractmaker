/**
 * Abstração de envio de email.
 *
 * Providers: `smtp` (nodemailer — usado em produção) e `resend` (legado, default
 * histórico). Sem provider reconhecido, cai em log-only.
 *
 * Para enviar emails: chame `sendEmail({to, subject, react})` passando um
 * componente React (templates em ./templates/*). O render JSX→HTML acontece aqui
 * dentro; nenhum call-site precisa saber qual é o transporte.
 *
 * Contrato: NUNCA lança. Devolve `{ ok:false, error }` quando o provedor recusa —
 * quem chama precisa LER esse `ok` (um try/catch sozinho não vê a recusa e acaba
 * dizendo "enviado" pra um e-mail que nunca saiu).
 */

import { STAGING_MODE } from "@/lib/env/staging";
import { maskEmail } from "@/lib/security/pii";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendEmailInput {
  to: string | string[];
  /**
   * Cópia oculta. Usada pra enviar A MESMA mensagem a vários destinatários SEM
   * que um veja o e-mail do outro (ex.: resumo pra vendedor + comprador — cada
   * um é uma parte que não pode ver o contato da outra). O gate de staging vale
   * pro bcc também.
   */
  bcc?: string | string[];
  subject: string;
  react?: React.ReactElement;
  html?: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  /**
   * Org que assina o e-mail. Quando presente, o template é renderizado com a
   * marca da imobiliária (logo, nome, cor) em vez da marca da plataforma.
   * Omitir em e-mails de plataforma (reset de senha, OTP).
   */
  orgId?: string;
  // Anexos binários. Formato do nodemailer ({filename, content, contentType});
  // o Resend aceita o mesmo shape. Sem retry embutido — quem chama decide o
  // fallback sem anexos ao receber ok:false (o relay pode recusar por tamanho).
  attachments?: EmailAttachment[];
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
      ...(input.bcc ? { bcc: Array.isArray(input.bcc) ? input.bcc : [input.bcc] } : {}),
      subject: input.subject,
      react: input.react,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo ?? getReplyTo(),
      tags: input.tags,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
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

/**
 * Envio por SMTP (nodemailer). É o caminho de produção desde 2026-07: o Resend
 * exigia domínio verificado e, sem isso, só entregava e-mail pro dono da conta —
 * ou seja, nenhum e-mail chegava aos clientes (acesso de dono, reset de senha,
 * convites, avisos de cobrança).
 *
 * SMTP genérico DE PROPÓSITO, em vez da API HTTP de um vendor: Brevo, Mailjet,
 * Postmark e até o Gmail falam SMTP. Trocar de provedor é mudar `SMTP_*` no
 * ambiente — sem código novo e sem repetir o lock-in que nos trouxe até aqui.
 *
 * O corpo vem dos mesmos templates React de sempre: `@react-email/render` faz o
 * JSX virar HTML (e a versão texto), papel que antes era do SDK do Resend.
 */
async function sendViaSmtp(input: SendEmailInput): Promise<SendEmailResult> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn("[email] SMTP_HOST/SMTP_USER/SMTP_PASS ausentes — email não enviado");
    return { id: null, ok: false, error: "SMTP config missing" };
  }

  try {
    const transporter = await getSmtpTransporter({ host, user, pass });

    let html = input.html;
    let text = input.text;
    if (!html && input.react) {
      const { render } = await import("@react-email/render");
      html = await render(input.react);
      text = text ?? (await render(input.react, { plainText: true }));
    }

    const info = await transporter.sendMail({
      from: getFrom(),
      to: Array.isArray(input.to) ? input.to : [input.to],
      ...(input.bcc ? { bcc: Array.isArray(input.bcc) ? input.bcc : [input.bcc] } : {}),
      subject: input.subject,
      html,
      text,
      replyTo: input.replyTo ?? getReplyTo(),
      // `tags` é conceito do Resend; em SMTP o equivalente útil é um header de
      // correlação, lido depois nos logs do provedor.
      headers: input.tags?.length
        ? { "X-Entity-Ref-ID": input.tags.map((t) => `${t.name}:${t.value}`).join(",") }
        : undefined,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    return { id: info.messageId ?? null, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] SMTP send failed", msg);
    return { id: null, ok: false, error: msg };
  }
}

/**
 * Transporter memoizado por processo. `notifications.ts` e `transfers/route.ts`
 * mandam e-mail em loop por destinatário — sem pool, cada mensagem abriria (e
 * derrubaria) uma conexão SMTP nova, o que o relay trata como abuso.
 */
let smtpTransporter: import("nodemailer").Transporter | null = null;

async function getSmtpTransporter(cfg: { host: string; user: string; pass: string }) {
  if (smtpTransporter) return smtpTransporter;
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT ?? 587);
  smtpTransporter = nodemailer.createTransport({
    host: cfg.host,
    port,
    // 465 é TLS implícito; 587 abre em claro e sobe pra TLS via STARTTLS.
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    pool: true,
    maxConnections: 3,
  });
  return smtpTransporter;
}

/** Só pra teste: descarta o transporter memoizado entre casos. */
export function __resetSmtpTransporterForTests() {
  smtpTransporter = null;
}

function logOnly(input: SendEmailInput): SendEmailResult {
  console.log("[email:dev] subject=%s to=%s", input.subject, input.to);
  return { id: "dev-log", ok: true };
}

/** Mascara destinatário(s) pra log — reusa o maskEmail canônico do pii.ts. */
function maskRecipient(to: string | string[]): string {
  const list = Array.isArray(to) ? to : [to];
  return list.map((addr) => maskEmail(addr)).join(", ");
}

/**
 * Renderiza o template JÁ com a marca da imobiliária. Ponto ÚNICO de injeção:
 * nenhum dos 13 templates nem dos call-sites precisa saber de branding — quem
 * tem `orgId` em escopo passa, e o e-mail sai assinado pela imobiliária em vez
 * de "Contractmaker". Sem `orgId` (reset de senha, OTP), vale a marca da
 * plataforma.
 *
 * O render acontece AQUI (e não dentro de cada provider) porque a marca vive num
 * escopo de AsyncLocalStorage: renderizando dentro do escopo, os dois providers
 * recebem HTML pronto e ninguém depende de React Context — que nem existe no
 * bundle `react-server` do Next.
 *
 * Falha de resolução nunca derruba o envio: sai com a marca da plataforma.
 */
async function renderWithBrand(input: SendEmailInput): Promise<SendEmailInput> {
  if (!input.react || input.html) return input;

  const [{ render }, { withEmailBrand, PLATFORM_BRAND }] = await Promise.all([
    import("@react-email/render"),
    import("./templates/shared"),
  ]);

  let brand = PLATFORM_BRAND;
  if (input.orgId) {
    try {
      const { getOrgBrand } = await import("@/lib/tenant/branding");
      const b = await getOrgBrand(input.orgId);
      brand = {
        displayName: b.displayName,
        logoUrl: b.logoUrl,
        primaryColor: b.primaryColor,
        supportEmail: b.supportEmail,
      };
    } catch (err) {
      console.warn("[email] falha ao resolver a marca da org %s: %s", input.orgId, err);
    }
  }

  const element = input.react;
  const html = await withEmailBrand(brand, () => render(element));
  const text =
    input.text ?? (await withEmailBrand(brand, () => render(element, { plainText: true })));

  // `react` sai do input: os providers passam a receber HTML pronto (o Resend
  // renderizaria por conta própria, FORA do escopo da marca).
  return { ...input, react: undefined, html, text };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const gated = applyStagingEmailGate(input.to);
  // O bcc também passa pelo gate — senão um destinatário externo em bcc vazaria
  // em staging. Se ele redireciona, dropa o bcc (a mensagem já vai pro override).
  const gatedBcc = input.bcc ? applyStagingEmailGate(input.bcc) : null;
  if (gated.to.length === 0) {
    return { id: "staging-blocked", ok: true };
  }
  const branded = await renderWithBrand(input);
  const effective: SendEmailInput = gated.redirected
    ? {
        ...branded,
        to: gated.to,
        bcc: undefined,
        subject: `[STAGING] ${input.subject} (originalmente: ${gated.original.join(", ")})`,
      }
    : { ...branded, bcc: gatedBcc ? gatedBcc.to : input.bcc };

  const provider = process.env.EMAIL_PROVIDER ?? "resend";

  let result: SendEmailResult;
  if (provider === "smtp") result = await sendViaSmtp(effective);
  else if (provider === "resend") result = await sendViaResend(effective);
  else {
    // ses: placeholder — implementar on-demand
    console.warn(`[email] provider "${provider}" não implementado, usando log-only`);
    result = logOnly(effective);
  }

  // Log estruturado da recusa AQUI, no ponto único: ~15 call-sites descartam o
  // retorno (convites, notificações financeiras, magic link), e sem esta linha
  // um e-mail que nunca saiu não deixa rastro com destinatário+assunto — os
  // logs dos providers acima não têm esse contexto.
  if (!result.ok) {
    console.error(
      "[email] envio FALHOU provider=%s to=%s subject=%j error=%s",
      provider,
      maskRecipient(effective.to),
      input.subject,
      result.error ?? "?"
    );
  }
  return result;
}
