import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

function makeReq(body: unknown = {}) {
  return new NextRequest("http://localhost/api/intents/i-1/reject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

/**
 * Esta rota não tinha teste nenhum até a #520 — foi assim que ela ficou aberta
 * enquanto a irmã (`approve`) recebia atenção. Rejeitar é a outra metade da
 * mesma decisão humana: quem não pode dizer sim não pode dizer não.
 */
describe("POST /api/intents/[id]/reject", () => {
  it("NEGA viewer com 403 — o veto silencioso que o gate fecha", async () => {
    // Sem o gate, um `viewer` percorria a fila de /intents (que lista tudo da
    // org para qualquer membro) e levava pedidos legítimos ao estado terminal
    // `rejected`, matando a requisição do agente externo sem explicação.
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.orgMembership.findUnique.mockResolvedValueOnce({
      role: "viewer",
      customRole: null,
    } as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(403);
    // Asserção no CORPO, não no status: a rota já devolve 403 para Bearer no
    // guard do HITL, então `status === 403` sozinho passaria com o gate morto.
    await expect(res.json()).resolves.toMatchObject({
      error: "PERMISSION_DENIED",
      permission: "newton.intent.approve",
    });
  });

  it("NEGA antes de ler a intent — não revela existência nem estado", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.orgMembership.findUnique.mockResolvedValueOnce({
      role: "viewer",
      customRole: null,
    } as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(403);
    expect(mockPrisma.actionIntent.findUnique).not.toHaveBeenCalled();
  });

  it("NEGA quem não é membro da org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.orgMembership.findUnique.mockResolvedValueOnce(null as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(403);
  });

  it("PERMITE gestor_financeiro — preset que já declarava a permissão", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.orgMembership.findUnique.mockResolvedValueOnce({
      role: "gestor_financeiro",
      customRole: null,
    } as never);
    mockPrisma.actionIntent.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    // Passou do gate e morreu no 404 legítimo — que é o que se quer provar.
    expect(res.status).toBe(404);
  });

  it("rejeita Bearer com 403 (a decisão humana exige sessão)", async () => {
    const req = new NextRequest("http://localhost/api/intents/i-1/reject", {
      method: "POST",
      headers: { authorization: "Bearer cmt_x", "content-type": "application/json" },
      body: "{}",
    });
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "tk-1",
      userId: "u-1",
      scopes: [],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockReturnValue({ catch: vi.fn() } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: "u@x.com",
      name: "U",
    } as never);
    mockPrisma.orgMembership.findFirst.mockResolvedValue({
      orgId: "org-1",
      org: createMockOrg(),
    } as never);
    const res = await POST(req, { params: { id: "i-1" } });
    expect(res.status).toBe(403);
  });
});
