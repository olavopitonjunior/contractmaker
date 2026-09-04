import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes do consumo de impersonation (super_admin "testar como" o dono da org).
 * Mocks: next/headers (cookie + x-pathname) + prisma (platformRole,
 * tenantImpersonationSession, orgMembership).
 *
 * Cada caso usa um userId ÚNICO — getImpersonationFor é React.cache(), que
 * memoiza por argumento no processo.
 */

const mockCookieGet = vi.fn();
const mockHeaderGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockCookieGet }),
  headers: () => ({ get: mockHeaderGet }),
}));

const mockPlatformRole = vi.fn();
const mockImpSession = vi.fn();
const mockMembership = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    platformRole: { findUnique: (a: unknown) => mockPlatformRole(a) },
    tenantImpersonationSession: { findFirst: (a: unknown) => mockImpSession(a) },
    orgMembership: { findFirst: (a: unknown) => mockMembership(a) },
  },
}));

import { getImpersonationFor, getEffectiveUserId, isImpersonating } from "../impersonation";

/** Configura o "caminho feliz" e permite sobrescrever por caso. */
function happyPath() {
  mockCookieGet.mockReturnValue({ value: "org1" }); // cookie mt_impersonate = orgId
  mockHeaderGet.mockReturnValue("/locacao"); // x-pathname (superfície de tenant)
  mockPlatformRole.mockResolvedValue({ role: "super_admin", scope: [] });
  mockImpSession.mockResolvedValue({ id: "imp1", endsAt: new Date("2026-09-05T04:00:00.000Z") }); // sessão ativa
  mockMembership.mockResolvedValue({ userId: "owner-neto" }); // owner da org
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getImpersonationFor", () => {
  it("sem cookie → null (caminho quente, nem toca no banco)", async () => {
    happyPath();
    mockCookieGet.mockReturnValue(undefined);
    expect(await getImpersonationFor("admin-a")).toBeNull();
    expect(mockPlatformRole).not.toHaveBeenCalled();
  });

  it("cookie + super_admin + sessão ativa + owner → contexto do owner", async () => {
    happyPath();
    expect(await getImpersonationFor("admin-b")).toEqual({
      orgId: "org1",
      ownerUserId: "owner-neto",
      // O vencimento acompanha o contexto: é o que o banner mostra e vigia (#587).
      endsAt: new Date("2026-09-05T04:00:00.000Z"),
    });
  });

  it("usuário não é super_admin → null", async () => {
    happyPath();
    mockPlatformRole.mockResolvedValue({ role: "support", scope: [] });
    expect(await getImpersonationFor("admin-c")).toBeNull();
    expect(mockImpSession).not.toHaveBeenCalled();
  });

  it("sem PlatformRole (não é staff) → null", async () => {
    happyPath();
    mockPlatformRole.mockResolvedValue(null);
    expect(await getImpersonationFor("admin-d")).toBeNull();
  });

  it("sessão de impersonation expirada/ausente (findFirst null) → null", async () => {
    happyPath();
    mockImpSession.mockResolvedValue(null);
    expect(await getImpersonationFor("admin-e")).toBeNull();
    expect(mockMembership).not.toHaveBeenCalled();
  });

  it("path-guard: /api/admin nunca sofre overlay → null (id cru)", async () => {
    happyPath();
    mockHeaderGet.mockReturnValue("/api/admin/orgs/org1/impersonate");
    expect(await getImpersonationFor("admin-f")).toBeNull();
    expect(mockPlatformRole).not.toHaveBeenCalled();
  });

  it("path-guard: /api/me (segurança da conta) → null", async () => {
    happyPath();
    mockHeaderGet.mockReturnValue("/api/me/password");
    expect(await getImpersonationFor("admin-g")).toBeNull();
  });

  it("path-guard: /api/security (2FA/elevação) → null", async () => {
    happyPath();
    mockHeaderGet.mockReturnValue("/api/security/2fa/disable");
    expect(await getImpersonationFor("admin-g2")).toBeNull();
  });

  it("path-guard: prefixo similar não-guardado (/administrar) NÃO é bloqueado", async () => {
    happyPath();
    mockHeaderGet.mockReturnValue("/administrar/algo");
    expect(await getImpersonationFor("admin-h")).not.toBeNull();
  });

  it("org sem owner → null (não escala)", async () => {
    happyPath();
    mockMembership.mockResolvedValue(null);
    expect(await getImpersonationFor("admin-i")).toBeNull();
  });

  it("cookies() lançando (fora de request) → null", async () => {
    happyPath();
    mockCookieGet.mockImplementation(() => {
      throw new Error("cookies() outside request scope");
    });
    expect(await getImpersonationFor("admin-j")).toBeNull();
  });
});

describe("getEffectiveUserId / isImpersonating", () => {
  it("impersonando → retorna ownerUserId + isImpersonating true", async () => {
    happyPath();
    expect(await getEffectiveUserId("admin-k")).toBe("owner-neto");
    expect(await isImpersonating("admin-k")).toBe(true);
  });

  it("sem impersonation → retorna o próprio id + isImpersonating false", async () => {
    happyPath();
    mockCookieGet.mockReturnValue(undefined);
    expect(await getEffectiveUserId("admin-l")).toBe("admin-l");
    expect(await isImpersonating("admin-l")).toBe(false);
  });
});
