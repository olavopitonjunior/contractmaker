/**
 * Troca/definição de senha do próprio usuário.
 *
 * O ponto sensível: `currentPassword` virou opcional pra atender conta de
 * convite (nasce sem `passwordHash` — não existe senha antiga a confirmar).
 * Estes testes travam a fronteira: a dispensa vem do BANCO, nunca do corpo
 * da request. Quem tem hash continua obrigado a acertar a senha atual.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/security/ratelimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

import { POST } from "../route";

type MockFn = ReturnType<typeof vi.fn>;
const authMock = auth as unknown as MockFn;
const getUserOrgMock = getUserOrg as unknown as MockFn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

function req(body: unknown) {
  return new NextRequest("http://localhost/api/me/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const REAL_HASH = bcrypt.hashSync("senha-antiga", 10);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  getUserOrgMock.mockResolvedValue({ id: "org-1" });
  // `twoFactorSecret`/`session` não existem no mock global do Prisma.
  p.twoFactorSecret = { findUnique: vi.fn().mockResolvedValue(null) };
  p.session = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  p.user.update = vi.fn().mockResolvedValue({});
});

describe("POST /api/me/password", () => {
  it("conta SEM hash define a senha sem informar senha atual", async () => {
    p.user.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "u1", passwordHash: null });

    const res = await POST(req({ newPassword: "senha-nova-123" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      firstPassword: true,
    });
    expect(p.user.update).toHaveBeenCalledOnce();
  });

  it("conta COM hash exige senha atual — corpo sem ela é 400", async () => {
    p.user.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "u1", passwordHash: REAL_HASH });

    const res = await POST(req({ newPassword: "senha-nova-123" }));

    expect(res.status).toBe(400);
    expect(p.user.update).not.toHaveBeenCalled();
  });

  it("conta COM hash rejeita senha atual errada — 401", async () => {
    p.user.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "u1", passwordHash: REAL_HASH });

    const res = await POST(
      req({ currentPassword: "chute", newPassword: "senha-nova-123" })
    );

    expect(res.status).toBe(401);
    expect(p.user.update).not.toHaveBeenCalled();
  });

  it("conta COM hash e senha atual correta troca a senha", async () => {
    p.user.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "u1", passwordHash: REAL_HASH });

    const res = await POST(
      req({ currentPassword: "senha-antiga", newPassword: "senha-nova-123" })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ firstPassword: false });
    expect(p.user.update).toHaveBeenCalledOnce();
  });

  it("2FA continua obrigatório no primeiro acesso", async () => {
    p.user.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "u1", passwordHash: null });
    p.twoFactorSecret.findUnique = vi.fn().mockResolvedValue({
      enabled: true,
      secretEncrypted: "x",
      secretIvBase64: "y",
      secretTagBase64: "z",
    });

    const res = await POST(req({ newPassword: "senha-nova-123" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ requires2FA: true });
    expect(p.user.update).not.toHaveBeenCalled();
  });
});
