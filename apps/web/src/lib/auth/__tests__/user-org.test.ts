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
const mockOrgCount = vi.fn();
const mockMembershipFindFirst = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    organization: {
      findUnique: (a: unknown) => mockOrgFindUnique(a),
      count: (a: unknown) => mockOrgCount(a),
    },
    orgMembership: { findFirst: (a: unknown) => mockMembershipFindFirst(a) },
  },
}));

import { getUserOrg } from "../user-org";

/** Simula os headers de request: x-pathname (setado pelo middleware nas rotas do
 *  matcher) e x-org-subdomain. Sem path → simula rota fora do matcher. */
function setHeaders(opts: { path?: string | null; subdomain?: string | null }) {
  mockHeaderGet.mockImplementation((k: string) =>
    k === "x-pathname"
      ? opts.path ?? null
      : k === "x-org-subdomain"
        ? opts.subdomain ?? null
        : null
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockImpersonation.mockResolvedValue(null); // sem impersonation por padrão
  mockOrgCount.mockResolvedValue(1); // subdomínio = tenant real por padrão
  setHeaders({ path: null, subdomain: null }); // apex/fora do matcher por padrão
});

describe("getUserOrg — sweep multi-org", () => {
  it("(a) header presente (rota sanitizada) + user é membro → org do subdomínio", async () => {
    setHeaders({ path: "/pipeline", subdomain: "remaxtrio" });
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

  it("(b) header presente + tenant REAL + user NÃO é membro → null (sem acesso)", async () => {
    setHeaders({ path: "/pipeline", subdomain: "outratenant" });
    mockMembershipFindFirst.mockResolvedValue(null); // não é membro daquele subdomínio
    mockOrgCount.mockResolvedValue(1); // mas a org existe → tenant real

    const org = await getUserOrg("u1");

    expect(org).toBeNull();
  });

  it("(b2) FAIL-SAFE: subdomínio desconhecido (nenhuma org) → fallback, não lockout", async () => {
    // Ex.: label de infra 'staging' num env sem ROOT_DOMAIN próprio.
    setHeaders({ path: "/pipeline", subdomain: "staging" });
    mockMembershipFindFirst
      .mockResolvedValueOnce(null) // não é membro do subdomínio 'staging'
      .mockResolvedValueOnce({ org: { id: "org-first" } }); // fallback 1ª membership
    mockOrgCount.mockResolvedValue(0); // NENHUMA org tem subdomain 'staging'

    const org = await getUserOrg("u1");

    expect(org).toEqual({ id: "org-first" });
    // Caiu no fallback determinístico (tratou como apex)
    expect(mockMembershipFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderBy: [{ invitedAt: "asc" }, { id: "asc" }] })
    );
  });

  it("(c) sem header (apex) → primeira membership com orderBy determinístico", async () => {
    setHeaders({ path: "/pipeline", subdomain: null });
    mockMembershipFindFirst.mockResolvedValue({ org: { id: "org-first" } });

    const org = await getUserOrg("u1");

    expect(org).toEqual({ id: "org-first" });
    expect(mockMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        orderBy: [{ invitedAt: "asc" }, { id: "asc" }],
      })
    );
  });

  it("(c2) x-pathname AUSENTE (rota fora do matcher) → ignora x-org-subdomain forjado, cai no fallback", async () => {
    // Simula um header forjado numa rota onde o middleware não roda (sem x-pathname).
    setHeaders({ path: null, subdomain: "remaxtrio" });
    mockMembershipFindFirst.mockResolvedValue({ org: { id: "org-first" } });

    const org = await getUserOrg("u1");

    expect(org).toEqual({ id: "org-first" });
    // NÃO escopou por subdomínio (o header não é confiável fora do matcher)
    expect(mockMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } })
    );
  });

  it("(c3) rota FUNDA do matcher (ex. /api/forms/[token]/lock) → confia no header (não regride)", async () => {
    // Regressão do round 5: a lista de prefixos larga derrubava o hint aqui.
    // Com a guarda por presença de x-pathname, rota do matcher é confiada.
    setHeaders({ path: "/api/forms/abc/lock", subdomain: "remaxtrio" });
    mockMembershipFindFirst.mockResolvedValue({ org: { id: "org-trio", subdomain: "remaxtrio" } });

    const org = await getUserOrg("u1");

    expect(org).toEqual({ id: "org-trio", subdomain: "remaxtrio" });
    expect(mockMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", org: { subdomain: "remaxtrio" } } })
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
      expect.objectContaining({ orderBy: [{ invitedAt: "asc" }, { id: "asc" }] })
    );
  });

  it("(d2) headers() lança DynamicServerError → RE-LANÇA (não engole o sinal do Next)", async () => {
    const dyn = Object.assign(new Error("Dynamic server usage"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    mockHeaderGet.mockImplementation(() => {
      throw dyn;
    });

    await expect(getUserOrg("u1")).rejects.toBe(dyn);
    // Não caiu no fallback: a rota tem que virar dinâmica, não resolver org errada
    expect(mockMembershipFindFirst).not.toHaveBeenCalled();
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
      expect.objectContaining({ where: { userId: "u1" }, orderBy: [{ invitedAt: "asc" }, { id: "asc" }] })
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
