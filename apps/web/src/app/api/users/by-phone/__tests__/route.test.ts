import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession } from "@/__tests__/helpers";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

const CALLER_ORG = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
  // Org de quem PERGUNTA. A rota passou a confinar a resposta a ela.
  mockGetUserOrg.mockResolvedValue({ id: CALLER_ORG } as never);
});

function makeRequest(query: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/users/by-phone${query}`, {
    headers,
  });
}

/** Bearer reconhecido com os escopos dados. */
function tokenComEscopos(scopes: string[]) {
  mockAuth.mockResolvedValue(null as never);
  mockPrisma.userApiToken.findUnique.mockResolvedValue({
    id: "t1",
    userId: "u-token",
    scopes,
    revokedAt: null,
    expiresAt: null,
  } as never);
  mockPrisma.userApiToken.update.mockResolvedValue({} as never);
}

const bearer = { Authorization: "Bearer cmt_xyz" };

describe("GET /api/users/by-phone", () => {
  it("returns 401 when no auth", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when phone param missing", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Bad Request");
  });

  it("returns 400 when phone is malformed", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await GET(makeRequest("?phone=11987654321"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when phone has wrong country prefix", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await GET(makeRequest("?phone=%2B0123"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when user not found", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce(null as never);
    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when user is soft-deleted (LGPD)", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Test",
      deletedAt: new Date(),
      orgMemberships: [{ orgId: CALLER_ORG, role: "member" }],
    } as never);
    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when user has no membership in the caller's org", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Test",
      deletedAt: null,
      orgMemberships: [],
    } as never);
    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(404);
  });

  it("returns userId/orgId/role/name for valid lookup via session auth", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Olavo",
      deletedAt: null,
      orgMemberships: [{ orgId: CALLER_ORG, role: "owner" }],
    } as never);

    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      userId: "u1",
      orgId: CALLER_ORG,
      role: "owner",
      name: "Olavo",
    });
    // Privacy: email NOT in response
    expect("email" in body).toBe(false);
  });

  it("returns 403 when bearer auth lacks metrics:r scope", async () => {
    tokenComEscopos(["deals:rw"]);

    const res = await GET(makeRequest("?phone=%2B5511987654321", bearer));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toMatch(/metrics:r/);
  });

  it("succeeds with bearer auth when metrics:r scope present", async () => {
    tokenComEscopos(["metrics:r"]);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Olavo",
      deletedAt: null,
      orgMemberships: [{ orgId: CALLER_ORG, role: "owner" }],
    } as never);

    const res = await GET(makeRequest("?phone=%2B5511987654321", bearer));
    expect(res.status).toBe(200);
  });
});

/**
 * Regressão do vazamento cross-tenant.
 *
 * A rota usava `authOrBearer` cru e fazia `findUnique({ where: { phone } })` sem
 * filtro de org. Como `User.phone` é `@unique` GLOBAL, qualquer token com
 * `metrics:r` — de qualquer imobiliária — resolvia qualquer telefone da
 * plataforma para `{ userId, orgId, role, name }`, e com `withScope` levava
 * junto os ids de deals e contratos. Os tokens dos agentes já têm esse escopo,
 * então era superfície de hoje, não hipótese.
 */
describe("isolamento entre tenants", () => {
  it("a consulta é filtrada pela org de quem pergunta", async () => {
    tokenComEscopos(["metrics:r"]);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Olavo",
      deletedAt: null,
      orgMemberships: [{ orgId: CALLER_ORG, role: "owner" }],
    } as never);

    await GET(makeRequest("?phone=%2B5511987654321", bearer));

    const args = mockPrisma.user.findUnique.mock.calls[0][0] as {
      select: { orgMemberships: { where?: { orgId?: string } } };
    };
    expect(args.select.orgMemberships.where).toEqual({ orgId: CALLER_ORG });
  });

  /**
   * O usuário existe, mas em OUTRA imobiliária. O Prisma devolve o `User` (o
   * telefone é único global) com `orgMemberships` vazio por causa do filtro —
   * e a rota tem que tratar isso como inexistente.
   */
  it("telefone de usuário de outro tenant devolve 404, não os dados", async () => {
    tokenComEscopos(["metrics:r"]);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u-de-outra-org",
      name: "Pessoa da Concorrente",
      deletedAt: null,
      orgMemberships: [],
    } as never);

    const res = await GET(makeRequest("?phone=%2B5511987654321", bearer));

    expect(res.status).toBe(404);
    const body = await res.json();
    // Mesmo 404 de "não existe": distinguir os casos já entregaria que aquele
    // número pertence a alguém na plataforma.
    expect(body).toEqual({ error: "not_found" });
    expect(JSON.stringify(body)).not.toContain("u-de-outra-org");
    expect(JSON.stringify(body)).not.toContain("Concorrente");
  });

  it("withScope só enumera deals e contratos da org de quem pergunta", async () => {
    tokenComEscopos(["metrics:r", "users:delegate"]);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Olavo",
      deletedAt: null,
      orgMemberships: [{ orgId: CALLER_ORG, role: "owner" }],
    } as never);
    mockPrisma.deal.findMany.mockResolvedValueOnce([{ id: "d1" }] as never);
    mockPrisma.contract.findMany.mockResolvedValueOnce([{ id: "c1" }] as never);

    const res = await GET(
      makeRequest("?phone=%2B5511987654321&withScope=true", bearer)
    );

    expect(res.status).toBe(200);
    const dealWhere = (
      mockPrisma.deal.findMany.mock.calls[0][0] as {
        where: { pipeline?: { orgId?: string } };
      }
    ).where;
    // Deal escopa por `pipeline.orgId` — não existe `Deal.orgId`.
    expect(dealWhere.pipeline).toEqual({ orgId: CALLER_ORG });

    const contractWhere = (
      mockPrisma.contract.findMany.mock.calls[0][0] as {
        where: { deal?: { pipeline?: { orgId?: string } } };
      }
    ).where;
    expect(contractWhere.deal).toEqual({ pipeline: { orgId: CALLER_ORG } });
  });
});
