import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/contracts/c1/summary", { headers });
}

const baseContract = {
  id: "c1",
  dealId: "d1",
  status: "rascunho",
  version: 1,
  userId: "u1",
  updatedAt: new Date("2026-05-01T10:00:00Z"),
  envelopes: [],
  dataJson: {
    vendedores: [{ nome: "João Silva", cpf: "529.982.247-25" }],
    compradores: [{ nome: "Maria Oliveira" }],
    pagamento: { valor_total: 500000 },
  },
};

describe("GET /api/contracts/[id]/summary", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq(), { params: { id: "c1" } });
    expect(res.status).toBe(401);
  });

  it("403 com bearer sem contracts:rw", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      scopes: ["metrics:r"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);

    const res = await GET(
      makeReq({ Authorization: "Bearer cmt_x" }),
      { params: { id: "c1" } }
    );
    expect(res.status).toBe(403);
  });

  it("404 quando contrato não existe", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue(null as never);
    const res = await GET(makeReq(), { params: { id: "c1" } });
    expect(res.status).toBe(404);
  });

  it("403 via bearer quando user não é dono do contrato (cross-user guard)", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "intruder",
      scopes: ["contracts:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);
    mockPrisma.contract.findUnique.mockResolvedValue({
      ...baseContract,
      userId: "other-user",
    } as never);

    const res = await GET(
      makeReq({ Authorization: "Bearer cmt_x" }),
      { params: { id: "c1" } }
    );
    expect(res.status).toBe(403);
  });

  it("200 retorna sumário estruturado + markdown", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue(baseContract as never);
    const res = await GET(makeReq(), { params: { id: "c1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contractId).toBe("c1");
    expect(body.dealId).toBe("d1");
    expect(body.partes.vendedores[0].nome).toBe("João Silva");
    expect(body.partes.compradores[0].nome).toBe("Maria Oliveira");
    expect(body.valor).toBe(500000);
    expect(body.markdown).toContain("João Silva");
    expect(body.markdown).toContain("R$");
  });

  it("nomes nas partes mas sem CPF na response (privacy)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue(baseContract as never);
    const res = await GET(makeReq(), { params: { id: "c1" } });
    const body = await res.json();
    const stringified = JSON.stringify(body);
    expect(stringified).not.toContain("529.982.247-25");
    expect(stringified).not.toContain("cpf");
  });

  it("envelopeAtual reflete signers assinados / total", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue({
      ...baseContract,
      envelopes: [
        {
          id: "env-1",
          status: "running",
          signers: [
            { signedAt: new Date() },
            { signedAt: null },
            { signedAt: new Date() },
          ],
        },
      ],
    } as never);
    const res = await GET(makeReq(), { params: { id: "c1" } });
    const body = await res.json();
    expect(body.envelopeAtual.signedCount).toBe(2);
    expect(body.envelopeAtual.totalSigners).toBe(3);
    expect(body.markdown).toContain("(2/3 assinaram)");
  });

  it("envelopeAtual = null quando contrato não tem envelope", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue(baseContract as never);
    const res = await GET(makeReq(), { params: { id: "c1" } });
    const body = await res.json();
    expect(body.envelopeAtual).toBeNull();
  });
});
