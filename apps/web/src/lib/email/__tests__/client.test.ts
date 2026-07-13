import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock("nodemailer", () => ({
  default: { createTransport },
  createTransport,
}));

import { sendEmail, __resetSmtpTransporterForTests } from "../client";
import { PasswordResetEmail } from "../templates/password-reset";

const ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  __resetSmtpTransporterForTests();
  process.env.EMAIL_PROVIDER = "smtp";
  process.env.SMTP_HOST = "smtp-relay.brevo.com";
  process.env.SMTP_USER = "user";
  process.env.SMTP_PASS = "pass";
  process.env.EMAIL_FROM = "imobpro.ai <contato@imobpro.ia.br>";
  delete process.env.SMTP_PORT;
  delete process.env.EMAIL_REPLY_TO;
  sendMail.mockResolvedValue({ messageId: "<abc@brevo>" });
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("sendEmail — provider smtp", () => {
  it("renderiza o template React em HTML e texto (papel que era do SDK do Resend)", async () => {
    const res = await sendEmail({
      to: "neto@remax.com.br",
      subject: "Seu acesso",
      react: PasswordResetEmail({ resetUrl: "https://imobpro.ia.br/reset-password?token=x" }),
    });

    expect(res).toEqual({ id: "<abc@brevo>", ok: true });
    const arg = sendMail.mock.calls[0][0];
    expect(arg.to).toEqual(["neto@remax.com.br"]);
    expect(arg.from).toBe("imobpro.ai <contato@imobpro.ia.br>");
    expect(arg.html).toContain("Redefinir senha");
    expect(arg.html).toContain("https://imobpro.ia.br/reset-password?token=x");
    // A versão texto importa: sem ela, filtro de spam pontua pior.
    expect(arg.text).toBeTruthy();
    expect(arg.text).not.toContain("<html");
  });

  it("respeita html/text prontos (o digest de certidões não passa React)", async () => {
    await sendEmail({ to: "a@b.com", subject: "Digest", html: "<p>oi</p>", text: "oi" });
    const arg = sendMail.mock.calls[0][0];
    expect(arg.html).toBe("<p>oi</p>");
    expect(arg.text).toBe("oi");
  });

  // A invariante que motivou toda esta mudança: um provedor que RECUSA não pode
  // virar "enviado" — quem chama precisa conseguir ler a falha.
  it("devolve ok:false (sem lançar) quando o SMTP recusa", async () => {
    sendMail.mockRejectedValue(new Error("Invalid login: 535 Authentication failed"));

    const res = await sendEmail({ to: "a@b.com", subject: "x", html: "<p>x</p>" });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("535");
    expect(res.id).toBeNull();
  });

  it("devolve ok:false quando falta configuração de SMTP", async () => {
    delete process.env.SMTP_PASS;
    const res = await sendEmail({ to: "a@b.com", subject: "x", html: "<p>x</p>" });
    expect(res).toMatchObject({ ok: false, error: "SMTP config missing" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("reusa o transporter (pool) entre envios — notificações mandam em loop", async () => {
    await sendEmail({ to: "a@b.com", subject: "1", html: "<p>1</p>" });
    await sendEmail({ to: "c@d.com", subject: "2", html: "<p>2</p>" });
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});

describe("gate de staging", () => {
  it("redireciona destinatário externo e marca o subject", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env/staging", () => ({ STAGING_MODE: true }));
    process.env.STAGING_EMAIL_OVERRIDE = "olavo.piton@gmail.com";
    const { sendEmail: staged, __resetSmtpTransporterForTests: reset } = await import("../client");
    reset();

    const res = await staged({ to: "neto@remax.com.br", subject: "Seu acesso", html: "<p>x</p>" });

    expect(res.ok).toBe(true);
    const arg = sendMail.mock.calls[0][0];
    expect(arg.to).toEqual(["olavo.piton@gmail.com"]);
    expect(arg.subject).toBe("[STAGING] Seu acesso (originalmente: neto@remax.com.br)");
    vi.doUnmock("@/lib/env/staging");
  });

  // Gotcha documentado: sem override, o envio some devolvendo ok:true. É por isso
  // que o .env.example agora avisa — e é a primeira coisa a checar quando "o
  // e-mail sumiu no staging".
  it("STAGING_MODE sem override bloqueia o envio (e ainda assim responde ok)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env/staging", () => ({ STAGING_MODE: true }));
    delete process.env.STAGING_EMAIL_OVERRIDE;
    const { sendEmail: staged } = await import("../client");

    const res = await staged({ to: "neto@remax.com.br", subject: "x", html: "<p>x</p>" });

    expect(res).toEqual({ id: "staging-blocked", ok: true });
    expect(sendMail).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/env/staging");
  });
});
