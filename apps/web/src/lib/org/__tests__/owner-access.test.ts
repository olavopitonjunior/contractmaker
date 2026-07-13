import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/password-reset", () => ({
  createPasswordResetToken: vi.fn(),
}));
vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn(),
}));

import { sendOwnerAccessEmail } from "../owner-access";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email/client";

const mockToken = vi.mocked(createPasswordResetToken);
const mockSend = vi.mocked(sendEmail);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://imobpro.ia.br";
  mockToken.mockResolvedValue({ token: "tok-123", expiresAt: new Date() });
});

describe("sendOwnerAccessEmail", () => {
  it("manda o link de definir senha com o token welcome", async () => {
    mockSend.mockResolvedValue({ id: "re_1", ok: true });

    await expect(
      sendOwnerAccessEmail({ email: "dono@imob.com.br", orgName: "RE/MAX Ativa" })
    ).resolves.toBe(true);

    expect(mockToken).toHaveBeenCalledWith("dono@imob.com.br", "welcome");
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("dono@imob.com.br");
    expect(arg.subject).toContain("RE/MAX Ativa");
  });

  // O modo de falha que importa: o Resend recusa (domínio não verificado, chave
  // ausente) e NÃO lança — devolve ok:false. Dizer "enviado" aqui deixaria o dono
  // esperando um link que nunca chegou.
  it("retorna false quando o provider recusa (sem lançar)", async () => {
    mockSend.mockResolvedValue({ id: null, ok: false, error: "domain not verified" });

    await expect(
      sendOwnerAccessEmail({ email: "dono@imob.com.br", orgName: "RE/MAX Ativa" })
    ).resolves.toBe(false);
  });

  it("retorna false (e não lança) quando o envio explode", async () => {
    mockSend.mockRejectedValue(new Error("network"));

    await expect(
      sendOwnerAccessEmail({ email: "dono@imob.com.br", orgName: "RE/MAX Ativa" })
    ).resolves.toBe(false);
  });
});
