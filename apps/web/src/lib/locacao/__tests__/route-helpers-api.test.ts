import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ensureLocacaoApiAccess, isRouteError } from "../route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { requireApiAuth } from "@/lib/api/require-auth";
import { assertFeatureEnabled, assertModuleEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { getEffectiveUserId } from "@/lib/auth/impersonation";

vi.mock("@/lib/api/require-auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/api/require-auth")>();
  return { ...orig, requireApiAuth: vi.fn() };
});
vi.mock("@/lib/modules/guard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/modules/guard")>();
  return {
    ...orig,
    assertFeatureEnabled: vi.fn(),
    assertModuleEnabled: vi.fn(),
  };
});
vi.mock("@/lib/security/rbac/check", () => ({
  getEffectivePermissions: vi.fn(),
  can: vi.fn(),
}));
vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(),
}));

const mockRequireApiAuth = vi.mocked(requireApiAuth);
const mockAssertFeature = vi.mocked(assertFeatureEnabled);
const mockAssertModule = vi.mocked(assertModuleEnabled);
const mockGetPerms = vi.mocked(getEffectivePermissions);
const mockCan = vi.mocked(can);
const mockGetEffectiveUserId = vi.mocked(getEffectiveUserId);

const req = new NextRequest("http://localhost/api/locacao/leases");

function bearerAuth(userId = "bot-1") {
  return {
    ident: { via: "bearer" as const, userId, tokenId: "t1", scopes: ["locacao:rw"] },
    actor: { effectiveUserId: userId, via: "newton" as const },
    org: { id: "org-1" },
  };
}
function sessionAuth(userId = "human-1") {
  return {
    ident: { via: "session" as const, userId, email: "h@x.com" },
    actor: { effectiveUserId: userId },
    org: { id: "org-1" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPerms.mockResolvedValue({ perms: true } as never);
  mockCan.mockReturnValue(true);
  mockGetEffectiveUserId.mockImplementation(async (id: string) => id);
});

describe("ensureLocacaoApiAccess", () => {
  it("bearer com scope: passa e retorna via=bearer + auth", async () => {
    mockRequireApiAuth.mockResolvedValueOnce(bearerAuth() as never);
    const ctx = await ensureLocacaoApiAccess(req, PERMISSION.LEASE_VIEW, {
      scope: "locacao:r",
    });
    expect(isRouteError(ctx)).toBe(false);
    if (isRouteError(ctx)) throw new Error("unreachable");
    expect(ctx.via).toBe("bearer");
    expect(ctx.orgId).toBe("org-1");
    expect(ctx.userId).toBe("bot-1");
    expect(ctx.auth.org.id).toBe("org-1");
    // Bearer NÃO passa por impersonation (getEffectiveUserId é caminho de session)
    expect(mockGetEffectiveUserId).not.toHaveBeenCalled();
    expect(mockRequireApiAuth).toHaveBeenCalledWith(req, { scope: "locacao:r" });
  });

  it("bearer sem scope: repassa a falha do requireApiAuth (403)", async () => {
    mockRequireApiAuth.mockResolvedValueOnce({
      error: "Forbidden",
      reason: "missing scope locacao:r",
      status: 403,
    } as never);
    const ctx = await ensureLocacaoApiAccess(req, PERMISSION.LEASE_VIEW, {
      scope: "locacao:r",
    });
    expect(isRouteError(ctx)).toBe(true);
    expect((ctx as NextResponse).status).toBe(403);
  });

  it("módulo/feature desabilitado → 403 MODULE_DISABLED", async () => {
    mockRequireApiAuth.mockResolvedValueOnce(bearerAuth() as never);
    // LEASE_VIEW não tem feature mapeada → gateia no módulo
    mockAssertModule.mockRejectedValueOnce(
      new ModuleDisabledError("MODULE_DISABLED", 403) as never
    );
    const ctx = await ensureLocacaoApiAccess(req, PERMISSION.LEASE_VIEW, {
      scope: "locacao:r",
    });
    expect(isRouteError(ctx)).toBe(true);
    expect((ctx as NextResponse).status).toBe(403);
  });

  it("RBAC negado (dono do token sem permission) → 403", async () => {
    mockRequireApiAuth.mockResolvedValueOnce(bearerAuth() as never);
    mockCan.mockReturnValueOnce(false);
    const ctx = await ensureLocacaoApiAccess(req, PERMISSION.GUARANTEE_MANAGE, {
      scope: "locacao:rw",
    });
    expect(isRouteError(ctx)).toBe(true);
    expect((ctx as NextResponse).status).toBe(403);
    const body = await (ctx as NextResponse).json();
    expect(body.error).toContain("guarantee.manage");
  });

  it("session: preserva impersonation via getEffectiveUserId", async () => {
    mockRequireApiAuth.mockResolvedValueOnce(sessionAuth("owner-1") as never);
    mockGetEffectiveUserId.mockResolvedValueOnce("impersonated-9");
    const ctx = await ensureLocacaoApiAccess(req, PERMISSION.LEASE_VIEW, {
      scope: "locacao:r",
    });
    expect(isRouteError(ctx)).toBe(false);
    if (isRouteError(ctx)) throw new Error("unreachable");
    expect(ctx.via).toBe("session");
    expect(ctx.userId).toBe("impersonated-9");
    expect(mockGetEffectiveUserId).toHaveBeenCalledWith("owner-1");
  });

  it("feature explícita tem prioridade sobre o mapa da permission", async () => {
    mockRequireApiAuth.mockResolvedValueOnce(bearerAuth() as never);
    await ensureLocacaoApiAccess(req, PERMISSION.RENT_VIEW, {
      scope: "locacao:r",
      feature: "locacao.repasses" as never,
    });
    expect(mockAssertFeature).toHaveBeenCalledWith("org-1", "locacao.repasses");
  });
});
