/**
 * `user-scope` — a chave de política do usuário da plataforma.
 *
 * O que este arquivo protege é a fronteira e a FRESCURA. A rota existe porque
 * o Max carregava `role` no candidato de identidade, e aquele candidato é
 * gravado numa tabela sem TTL: o papel congelava, e rebaixar alguém na
 * plataforma não revogava o que o Max oferecia.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { chaveDePolitica } from "@/lib/max/user-identity";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

const E164 = "+5511999063228";

function req(phone: string) {
  return new NextRequest(
    `http://localhost/api/agents/user-scope?phone=${encodeURIComponent(phone)}`,
    // `cmt_` importa: verifyBearerToken recusa antes do lookup sem o prefixo.
    { headers: { authorization: "Bearer cmt_teste" } }
  );
}

function usuario(over: Record<string, unknown> = {}) {
  return {
    id: "u-1",
    name: "Olavo",
    deletedAt: null,
    orgMemberships: [
      { orgId: "org-1", role: "sales", customRoleId: null, ...over },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null as never);
  mockGetUserOrg.mockResolvedValue({ id: "org-1" } as never);
  mockPrisma.userApiToken.findUnique.mockResolvedValue({
    id: "tok-1",
    userId: "user-1",
    scopes: ["agents:r"],
    revokedAt: null,
    expiresAt: null,
  } as never);
  mockPrisma.userApiToken.update.mockResolvedValue({} as never);
  mockPrisma.orgModule.findMany.mockResolvedValue([
    { module: "vendas", enabled: true, featureFlags: { "vendas.max": true } },
  ] as never);
});

// ── O NEGADO ANTES DO PERMITIDO ────────────────────────────────────────────

describe("fronteira", () => {
  it("telefone não normalizável é 400, sem consultar o banco", async () => {
    const res = await GET(req("abc"));
    expect(res.status).toBe(400);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("usuário de OUTRO tenant é 404 — o mesmo 404 de inexistente", async () => {
    // `User.phone` é @unique GLOBAL: a linha existe, mas sem membership aqui.
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u-de-outra-org",
      name: "X",
      deletedAt: null,
      orgMemberships: [],
    } as never);
    const res = await GET(req(E164));
    expect(res.status).toBe(404);
    // Distinguir "não existe" de "é de outro tenant" confirmaria a existência
    // do cadastro para quem tem token de outra org.
    expect((await res.json()).reason).not.toMatch(/outr[ao]/i);
  });

  it("a consulta é confinada à org do TOKEN, não do telefone", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(usuario() as never);
    await GET(req(E164));
    const arg = mockPrisma.user.findUnique.mock.calls[0][0];
    expect(arg.select.orgMemberships.where).toEqual({ orgId: "org-1" });
  });
});

// ── A CHAVE ────────────────────────────────────────────────────────────────

describe("chave de política", () => {
  it("papel de preset vira a própria string", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(usuario() as never);
    const res = await GET(req(E164));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u-1", roleKey: "sales" });
  });

  it("papel CUSTOMIZADO vira custom:<id>, não o literal custom", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      usuario({ role: "custom", customRoleId: "cr-estagiario" }) as never
    );
    const res = await GET(req(E164));
    // É o defeito inteiro: sem o id, "Estagiário" e "Diretor" da mesma
    // imobiliária caíam os dois em `byRole.custom`.
    expect(await res.json()).toEqual({
      userId: "u-1",
      roleKey: "custom:cr-estagiario",
    });
  });

  it("dois papéis customizados da MESMA org produzem chaves DIFERENTES", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      usuario({ role: "custom", customRoleId: "cr-diretor" }) as never
    );
    const a = await (await GET(req(E164))).json();
    mockPrisma.user.findUnique.mockResolvedValue(
      usuario({ role: "custom", customRoleId: "cr-estagiario" }) as never
    );
    const b = await (await GET(req(E164))).json();
    expect(a.roleKey).not.toBe(b.roleKey);
  });

  it("membership degenerada (custom sem id) é null — fail-closed", async () => {
    // `role` é String livre no banco; esta linha é possível. Devolver "custom"
    // faria essa pessoa herdar o que a org conceder a papéis customizados.
    mockPrisma.user.findUnique.mockResolvedValue(
      usuario({ role: "custom", customRoleId: null }) as never
    );
    expect((await (await GET(req(E164))).json()).roleKey).toBeNull();
  });
});

// ── A FUNÇÃO PURA, DIRETO ──────────────────────────────────────────────────

describe("chaveDePolitica", () => {
  it("não confunde preset com prefixo", () => {
    expect(chaveDePolitica({ role: "sales", customRoleId: "x" })).toBe("sales");
    expect(chaveDePolitica({ role: "custom", customRoleId: "x" })).toBe("custom:x");
    expect(chaveDePolitica({ role: "custom", customRoleId: null })).toBeNull();
  });

  it("o prefixo NÃO colide com um preset chamado custom", () => {
    // `custom` cru continua existindo como valor de `OrgMembership.role`, e uma
    // org que tenha configurado `byRole.custom` NÃO deve alcançar quem tem
    // papel customizado de verdade — são chaves distintas.
    expect(chaveDePolitica({ role: "custom", customRoleId: "cr-1" })).not.toBe("custom");
  });
});
