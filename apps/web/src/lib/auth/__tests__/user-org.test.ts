import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes de getUserOrg — o núcleo do sweep multi-org. Verifica que o hint de
 * subdomínio (x-org-subdomain) é lido internamente quando nenhum opts é passado,
 * que o hint explícito vence, que impersonation vence tudo, e que o fallback é
 * a primeira membership determinística.
 *
 * Mocks: next/headers (headers().get), impersonation (getImpersonationFor),
 * prisma (organization/orgMembership).
 */

const mockHeaderGet = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => ({ get: mockHeaderGet }),
}));

const mockImpersonation = vi.fn();
vi.mock("../impersonation", () => ({
  getImpersonationFor: (u: string) => mockImpersonation(u),
}));

const mockOrgFindUnique = vi.fn();
const mockMembershipFindFirst = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    organization: { findUnique: (a: unknown) => mockOrgFindUnique(a) },
    orgMembership: { findFirst: (a: unknown) => mockMembershipFindFirst(a) },
  },
}));

import { getUserOrg } from "../user-org";

beforeEach(() => {
  vi.clearAllMocks();
  mockImpersonation.mockResolvedValue(null); // sem impersonation por padrão
  mockHeaderGet.mockReturnValue(null); // apex por padrão
});

describe("getUserOrg — sweep multi-org", () => {
  it("(a) header presente + user é membro → org do subdomínio", async () => {
    mockHeaderGet.mockReturnValue("remaxtrio");
    mockMembershipFindFirst.mockResolvedValue({ org: { id: "org-trio", subdomain: "remaxtrio" } });

    const org = await getUserOrg("u1");

    expect(org).toEqual({ id: "org-trio", subdomain: "remaxtrio" });
    // Resolveu escopado por subdomínio + membership
    expect(mockMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", org: { subdomain: "remaxtrio" } },
      })
    );
  });

  it("(b) header presente + user NÃO é membro do tenant → null (sem acesso)", async () => {
    mockHeaderGet.mockReturnValue("outratenant");
    mockMembershipFindFirst.mockResolvedValue(null); // não é membro daquele subdomínio

    const org = await getUserOrg("u1");

    expect(org).toBeNull();
  });

  it("(c) sem header (apex) → primeira membership com orderBy determinístico", async () => {
    mockHeaderGet.mockReturnValue(null);
    mockMembershipFindFirst.mockResolvedValue({ org: { id: "org-first" } });

    const org = await getUserOrg("u1");

    expect(org).toEqual({ id: "org-first" });
    expect(mockMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        orderBy: { invitedAt: "asc" },
      })
    );
  });

  it("(d) headers() lança (fora de request scope) → cai no fallback, não explode", async () => {
    mockHeaderGet.mockImplementation(() => {
      throw new Error("headers() called outside request scope");
    });
    mockMembershipFindFirst.mockResolvedValue({ org: { id: "org-first" } });

    const org = await getUserOrg("u1");

    expect(org).toEqual({ id: "org-first" });
    // Caiu no ramo de primeira membership (sem subdomínio)
    expect(mockMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { invitedAt: "asc" } })
    );
  });

  it("(e) opts.subdomainHint explícito vence o header do request", async () => {
    mockHeaderGet.mockReturnValue("do-header"); // não deve ser lido
    mockMembershipFindFirst.mockResolvedValue({ org: { id: "org-explicit", subdomain: "explicito" } });

    const org = await getUserOrg("u1", { subdomainHint: "explicito" });

    expect(org).toEqual({ id: "org-explicit", subdomain: "explicito" });
    expect(mockHeaderGet).not.toHaveBeenCalled(); // não releu headers
    expect(mockMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", org: { subdomain: "explicito" } },
      })
    );
  });

  it("(e2) opts com subdomainHint null (apex explícito) → fallback, sem reler header", async () => {
    mockHeaderGet.mockReturnValue("do-header"); // não deve ser lido
    mockMembershipFindFirst.mockResolvedValue({ org: { id: "org-first" } });

    const org = await getUserOrg("u1", { subdomainHint: null });

    expect(org).toEqual({ id: "org-first" });
    expect(mockHeaderGet).not.toHaveBeenCalled();
    expect(mockMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" }, orderBy: { invitedAt: "asc" } })
    );
  });

  it("(f) impersonation vence tudo (ignora hint e membership)", async () => {
    mockHeaderGet.mockReturnValue("qualquer");
    mockImpersonation.mockResolvedValue({ orgId: "org-impersonada" });
    mockOrgFindUnique.mockResolvedValue({ id: "org-impersonada" });

    const org = await getUserOrg("admin1");

    expect(org).toEqual({ id: "org-impersonada" });
    expect(mockOrgFindUnique).toHaveBeenCalledWith({ where: { id: "org-impersonada" } });
    expect(mockMembershipFindFirst).not.toHaveBeenCalled();
  });
});
