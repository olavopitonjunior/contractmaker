/**
 * Aprovação de convite — recorte: o e-mail que o convidado recebe.
 *
 * Antes, a conta nascia sem `passwordHash` e o e-mail mandava só
 * `/login?email=`. A única tela de senha disponível depois era a de trocar
 * senha, que pede "Senha atual" — senha que o convidado nunca teve. Agora
 * quem não tem hash recebe link de `/reset-password?token=` (reason
 * `welcome`) e CRIA a senha na hora.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/context", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/auth/invitations", () => ({
  isApprover: vi.fn(() => true),
}));
vi.mock("@/lib/auth/password-reset", () => ({
  createPasswordResetToken: vi
    .fn()
    .mockResolvedValue({ token: "tok-123", expiresAt: new Date() }),
}));
vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));
// A rota chama o template como função (não JSX), então o elemento devolvido é
// o EmailLayout — inspecionar as props exige espionar a própria chamada.
vi.mock("@/lib/email/templates/invitation-approved", () => ({
  InvitationApprovedEmail: vi.fn(() => null),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email/client";
import { InvitationApprovedEmail } from "@/lib/email/templates/invitation-approved";

type MockFn = ReturnType<typeof vi.fn>;
const requireAuthMock = requireAuth as unknown as MockFn;
const createTokenMock = createPasswordResetToken as unknown as MockFn;
const sendEmailMock = sendEmail as unknown as MockFn;
const emailTemplateMock = InvitationApprovedEmail as unknown as MockFn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

const INVITE_ID = "inv-1";

function req() {
  return new NextRequest(
    `http://localhost/api/org/invitations/${INVITE_ID}/approve`,
    { method: "POST" }
  );
}

const params = Promise.resolve({ id: INVITE_ID });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://app.test";

  requireAuthMock.mockResolvedValue({
    ok: true,
    ctx: {
      userId: "approver-1",
      userEmail: "olavo.piton@gmail.com",
      orgId: "org-1",
      orgName: "Imobiliária Teste",
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
    },
  });

  p.orgInvitation.findFirst = vi.fn().mockResolvedValue({
    id: INVITE_ID,
    orgId: "org-1",
    email: "convidado@teste.com",
    name: "Convidado",
    role: "member",
    status: "pending",
    invitedById: "approver-1",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  p.orgInvitation.update = vi.fn().mockResolvedValue({ id: INVITE_ID });
  p.orgMembership.findUnique = vi.fn().mockResolvedValue(null);
  p.orgMembership.create = vi.fn().mockResolvedValue({ id: "mem-1" });
  // Nenhuma atividade anterior por padrão (conta nova).
  p.orgMembership.count = vi.fn().mockResolvedValue(0);
  p.user.create = vi.fn().mockResolvedValue({
    id: "u-new",
    email: "convidado@teste.com",
    name: "Convidado",
    passwordHash: null,
  });
});

describe("POST /api/org/invitations/[id]/approve — e-mail de primeiro acesso", () => {
  it("conta nova (sem senha) recebe link que CRIA a senha, não login", async () => {
    p.user.findUnique = vi.fn().mockResolvedValue(null);

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);

    expect(createTokenMock).toHaveBeenCalledWith(
      "convidado@teste.com",
      "welcome"
    );

    expect(sendEmailMock.mock.calls[0][0].to).toBe("convidado@teste.com");
    const props = emailTemplateMock.mock.calls[0][0];
    expect(props.mode).toBe("set-password");
    expect(props.actionUrl).toBe("https://app.test/reset-password?token=tok-123");
  });

  it("conta ATIVA com senha recebe link de login e nenhum token", async () => {
    p.user.findUnique = vi.fn().mockResolvedValue({
      id: "u-old",
      email: "convidado@teste.com",
      name: "Convidado",
      passwordHash: "$2a$10$hash",
    });
    p.orgMembership.count = vi.fn().mockResolvedValue(1); // já usou o produto

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);

    expect(createTokenMock).not.toHaveBeenCalled();
    expect(p.user.create).not.toHaveBeenCalled();

    const props = emailTemplateMock.mock.calls[0][0];
    expect(props.mode).toBe("login");
    expect(props.actionUrl).toBe(
      "https://app.test/login?email=convidado%40teste.com"
    );
  });

  // `passwordHash != null` não prova que a pessoa SABE a senha: provisionamento
  // de tenant e api/org/members gravam hash aleatório de placeholder. Mandar
  // "use sua senha de sempre" pra quem nunca entrou reabre o beco sem saída.
  it("hash de placeholder + nunca autenticou → link que CRIA a senha", async () => {
    p.user.findUnique = vi.fn().mockResolvedValue({
      id: "u-provisionado",
      email: "convidado@teste.com",
      name: "Convidado",
      passwordHash: "$2a$10$placeholder-aleatorio",
    });
    p.orgMembership.count = vi.fn().mockResolvedValue(0); // nunca autenticou

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);

    expect(createTokenMock).toHaveBeenCalledWith(
      "convidado@teste.com",
      "welcome"
    );
    const props = emailTemplateMock.mock.calls[0][0];
    expect(props.mode).toBe("set-password");
    expect(props.actionUrl).toBe("https://app.test/reset-password?token=tok-123");
  });

  it("falha de envio não passa por sucesso silencioso — devolve emailSent:false", async () => {
    p.user.findUnique = vi.fn().mockResolvedValue(null);
    sendEmailMock.mockResolvedValueOnce({ id: null, ok: false, error: "smtp" });

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ emailSent: false });
  });
});
