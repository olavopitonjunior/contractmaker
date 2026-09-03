import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * Perímetro da revisão da biblioteca. Dois pontos merecem caso próprio:
 *
 *  - o gate é owner/admin, como o da edição que ela oferece — uma tela que
 *    lista consertos para quem não pode aplicá-los só produz erro;
 *  - Google fora do ar derruba SÓ os modelos. A base de cláusulas é banco e
 *    Handlebars puro, e recusar as duas por causa de uma esconderia metade do
 *    contrato por um problema que não é dela.
 */
const googleConfigured = vi.fn(() => true);
vi.mock("@/lib/google/client", () => ({
  isGoogleDocsConfigured: () => googleConfigured(),
}));

const reviewLibraryMock = vi.fn();
vi.mock("@/lib/templates/library-review", () => ({
  reviewLibrary: (...a: unknown[]) => reviewLibraryMock(...a),
}));

const reviewClauseMock = vi.fn();
vi.mock("@/lib/templates/clause-review", () => ({
  reviewClauseLibrary: (...a: unknown[]) => reviewClauseMock(...a),
}));

import { POST } from "../library-review/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = vi.fn();
Object.assign(prisma.orgMembership, { findFirst: membershipFindFirst });

const call = (body?: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }) as never
  );

beforeEach(() => {
  vi.clearAllMocks();
  googleConfigured.mockReturnValue(true);
  authMock.mockResolvedValue({ user: { id: "u1" } });
  getUserOrgMock.mockResolvedValue({ id: "org1" });
  membershipFindFirst.mockResolvedValue({ role: "owner" });
  reviewLibraryMock.mockResolvedValue({ rows: [], checkedAt: "", truncado: false });
  reviewClauseMock.mockResolvedValue({ rows: [], checkedAt: "", truncado: false });
});

describe("POST /api/templates/library-review", () => {
  it("sem sessão: 401", async () => {
    authMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("membro comum: 403 — a tela oferece consertos que ele não pode aplicar", async () => {
    membershipFindFirst.mockResolvedValue({ role: "member" });
    expect((await call()).status).toBe(403);
    expect(reviewLibraryMock).not.toHaveBeenCalled();
  });

  it("sem corpo, revisa os dois lados", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(reviewLibraryMock).toHaveBeenCalledWith({ orgId: "org1" });
    expect(reviewClauseMock).toHaveBeenCalledWith({ orgId: "org1" });
  });

  it("scope=clauses não toca no Google", async () => {
    await call({ scope: "clauses" });
    expect(reviewLibraryMock).not.toHaveBeenCalled();
    expect(reviewClauseMock).toHaveBeenCalled();
  });

  it("Google fora do ar: cláusulas seguem, modelos vêm com o motivo", async () => {
    googleConfigured.mockReturnValue(false);
    const res = await call();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.templates).toBeNull();
    expect(json.templatesIndisponivel).toBeTruthy();
    expect(json.clauses).toBeTruthy();
  });

  it("scope inválido: 400", async () => {
    expect((await call({ scope: "tudo" })).status).toBe(400);
  });

  it("falha no levantamento vira 500 sem vazar o erro interno", async () => {
    reviewClauseMock.mockRejectedValue(new Error("relation does not exist"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("relation does not exist");
  });
});
