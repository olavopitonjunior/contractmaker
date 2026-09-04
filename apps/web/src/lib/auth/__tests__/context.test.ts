import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAuth } from "../context";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getImpersonationFor } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { createMockSession } from "@/__tests__/helpers";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/security/ratelimit", () => ({
  RateLimits: {
    apiPerToken: vi.fn().mockResolvedValue({ success: true, limit: 100, reset: 0 }),
    apiPerSession: vi.fn().mockResolvedValue({ success: true, limit: 100, reset: 0 }),
  },
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);
const mockGetImpersonationFor = vi.mocked(getImpersonationFor);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: sem impersonation (clearAllMocks zera o valor de retorno padrão).
  mockGetImpersonationFor.mockResolvedValue(null);
});

function bearerReq(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/financeiro/charges", {
    headers: { Authorization: "Bearer cmt_valid", ...headers },
  });
}

function mockValidToken(scopes: string[]) {
  mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
    id: "tok-1",
    userId: "u1",
    scopes,
    revokedAt: null,
    expiresAt: null,
  } as never);
  mockPrisma.userApiToken.update.mockResolvedValueOnce({} as never);
}

describe("requireAuth — bearer exige rota com scope declarado", () => {
  it("bearer em rota SEM scope → 403 session-only", async () => {
    mockValidToken(["deals:rw", "charges:rw"]);
    mockPrisma.orgMembership.findFirst.mockResolvedValueOnce(null as never);

    const result = await requireAuth(bearerReq());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.reason).toMatch(/scoped endpoint|session-only/);
  });

  it("bearer em rota sem scope registra audit API_TOKEN_AUTH_FAILED", async () => {
    mockValidToken(["deals:rw"]);
    mockPrisma.orgMembership.findFirst.mockResolvedValueOnce({
      orgId: "org-1",
    } as never);

    const result = await requireAuth(bearerReq());
    expect(result.ok).toBe(false);

    // audit é fire-and-forget — dá um tick pro IIFE async completar
    await new Promise((r) => setTimeout(r, 0));
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "API_TOKEN_AUTH_FAILED",
          result: "DENIED",
          metadata: expect.objectContaining({
            reason: "bearer_on_unscoped_route",
            tokenId: "tok-1",
          }),
        }),
      })
    );
  });

  it("bearer com scope exigido e presente → ok", async () => {
    mockValidToken(["charges:rw"]);
    mockGetUserOrg.mockResolvedValueOnce({
      id: "org-1",
      name: "Org Teste",
    } as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      email: "newton@bot.dev",
      name: "Newton",
    } as never);

    const result = await requireAuth(bearerReq(), { scope: "charges:r" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.ctx.via).toBe("bearer");
    expect(result.ctx.orgId).toBe("org-1");
  });

  it("bearer sem o scope exigido → 403 missing scope (comportamento existente)", async () => {
    mockValidToken(["metrics:r"]);

    const result = await requireAuth(bearerReq(), { scope: "charges:rw" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.reason).toContain("missing scope charges:rw");
  });

  it("session em rota sem scope segue funcionando (UI inalterada)", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockGetUserOrg.mockResolvedValueOnce({
      id: "org-1",
      name: "Org Teste",
    } as never);

    const result = await requireAuth(
      new Request("http://localhost/api/financeiro/charges")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.ctx.via).toBe("session");
  });
});

describe("requireAuth — impersonation de tenant (super_admin trocou de tenant)", () => {
  it("session impersonando: ator efetivo vira o dono do tenant e a org é a impersonada", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockGetImpersonationFor.mockResolvedValue({
      orgId: "org-tenant",
      ownerUserId: "owner-9",
      endsAt: new Date("2026-09-05T04:00:00.000Z"),
    });
    mockPrisma.organization.findUnique.mockResolvedValueOnce({
      id: "org-tenant",
      name: "RE/MAX Trio",
    } as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      email: "dono@remaxtrio.com",
      name: "Dono",
    } as never);

    const result = await requireAuth(
      new Request("http://localhost/api/financeiro/charges")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // O RBAC por membership resolve contra o DONO — sem isso todo can() negava.
    expect(result.ctx.userId).toBe("owner-9");
    expect(result.ctx.orgId).toBe("org-tenant");
    // Rastro do admin real preservado pro audit.
    expect(result.ctx.impersonatedByUserId).toBe("user-1");
    // E o e-mail do admin real também: `userEmail` aqui é o do DONO, então
    // gate de plataforma que compara e-mail (allowlist de env) precisa deste.
    expect(result.ctx.userEmail).toBe("dono@remaxtrio.com");
    expect(result.ctx.impersonatedByEmail).toBe("test@example.com");
    // Sem query extra pra descobrir o e-mail do admin: só o lookup do dono.
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    // Org vem da impersonation, não da 1ª membership do dono.
    expect(mockGetUserOrg).not.toHaveBeenCalled();
    // Heartbeat não carimba a membership do dono com acesso que não foi dele.
    expect(mockPrisma.orgMembership.updateMany).not.toHaveBeenCalled();
  });

  it("bearer NUNCA sofre overlay (org do token, não de cookie)", async () => {
    mockValidToken(["charges:r"]);
    mockGetUserOrg.mockResolvedValueOnce({ id: "org-1", name: "Org" } as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      email: "newton@bot.dev",
      name: "Newton",
    } as never);

    const result = await requireAuth(bearerReq(), { scope: "charges:r" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.ctx.orgId).toBe("org-1");
    expect(result.ctx.impersonatedByUserId).toBeUndefined();
    expect(result.ctx.impersonatedByEmail).toBeUndefined();
    expect(mockGetImpersonationFor).not.toHaveBeenCalled();
  });

  it("sessão SEM impersonation não carrega ator real (o próprio já é o ator)", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockGetUserOrg.mockResolvedValueOnce({ id: "org-1", name: "Org" } as never);

    const result = await requireAuth(
      new Request("http://localhost/api/financeiro/charges")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.ctx.userEmail).toBe("test@example.com");
    // Nunca preenchido fora de impersonation: quem lê este campo está
    // perguntando "há alguém POR TRÁS deste ator?", e a resposta é não.
    expect(result.ctx.impersonatedByEmail).toBeUndefined();
  });
});
