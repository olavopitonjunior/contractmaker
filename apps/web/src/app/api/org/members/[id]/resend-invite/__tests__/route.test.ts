/**
 * Reenvio de convite — recorte: o retorno do envio não pode ser engolido.
 *
 * A rota respondia `{ok:true}` mesmo quando o relay recusava a mensagem. Como
 * o link de definir senha é a única porta de entrada de quem ainda não tem
 * senha, "reenviado com sucesso" pra um e-mail que não saiu deixa a pessoa
 * trancada do lado de fora sem ninguém perceber.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/security/rbac/guard", () => ({
  requirePermission: vi.fn().mockResolvedValue(undefined),
  PermissionDeniedError: class extends Error {},
  MembershipRequiredError: class extends Error {},
}));
vi.mock("@/lib/security/elevation", () => ({
  requireElevation: vi.fn().mockResolvedValue(undefined),
  ElevationRequiredError: class extends Error {},
}));
vi.mock("@/lib/auth/password-reset", () => ({
  createPasswordResetToken: vi
    .fn()
    .mockResolvedValue({ token: "tok-abc", expiresAt: new Date() }),
}));
vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "1", ok: true }),
}));
vi.mock("@/lib/email/templates/password-reset", () => ({
  WelcomeSetPasswordEmail: vi.fn(() => null),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/security/ratelimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

import { POST } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { sendEmail } from "@/lib/email/client";
import { WelcomeSetPasswordEmail } from "@/lib/email/templates/password-reset";

type MockFn = ReturnType<typeof vi.fn>;
const requireAuthMock = requireAuth as unknown as MockFn;
const sendEmailMock = sendEmail as unknown as MockFn;
const templateMock = WelcomeSetPasswordEmail as unknown as MockFn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

const MEMBERSHIP_ID = "mem-1";
const params = Promise.resolve({ id: MEMBERSHIP_ID });

function req() {
  return new NextRequest(
    `http://localhost/api/org/members/${MEMBERSHIP_ID}/resend-invite`,
    { method: "POST" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://app.test";

  requireAuthMock.mockResolvedValue({
    ok: true,
    ctx: {
      userId: "u-admin",
      userName: "Olavo",
      orgId: "org-1",
      orgName: "Imobiliária Teste",
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
    },
  });

  p.orgMembership.findFirst = vi.fn().mockResolvedValue({
    id: MEMBERSHIP_ID,
    orgId: "org-1",
    userId: "u-convidado",
    user: { id: "u-convidado", email: "convidado@teste.com" },
  });
});

describe("POST /api/org/members/[id]/resend-invite", () => {
  it("manda link de definir senha e reporta emailSent:true", async () => {
    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      emailSent: true,
    });
    expect(templateMock.mock.calls[0][0].setupUrl).toBe(
      "https://app.test/reset-password?token=tok-abc"
    );
  });

  it("relay recusando NÃO vira sucesso silencioso", async () => {
    sendEmailMock.mockResolvedValueOnce({ id: null, ok: false, error: "smtp" });

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ emailSent: false });
  });
});
