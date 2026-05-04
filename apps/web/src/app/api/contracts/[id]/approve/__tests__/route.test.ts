import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

function createRequest() {
  return new NextRequest("http://localhost/api/contracts/test-id/approve", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: usuário tem org. Override quando teste exigir o contrário.
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

describe("POST /api/contracts/[id]/approve", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(createRequest(), { params: { id: "test-id" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when contract not found", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce(null);
    const res = await POST(createRequest(), { params: { id: "nonexistent" } });
    expect(res.status).toBe(404);
  });

  it("returns 400 when already approved", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "test-id",
      status: "aprovado",
    } as any);
    const res = await POST(createRequest(), { params: { id: "test-id" } });
    expect(res.status).toBe(400);
  });

  it("returns 422 when validation has errors", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "test-id",
      status: "rascunho",
      dataJson: {
        vendedores: [
          { nome: "João", cpf: "111.111.111-11", estado_civil: "Solteiro(a)" },
        ],
        compradores: [],
        pagamento: { valor_total: 0 },
      },
    } as any);

    const res = await POST(createRequest(), { params: { id: "test-id" } });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(json.issues[0].severity).toBe("error");
  });

  it("returns 200 and approves when only warnings exist", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "test-id",
      status: "rascunho",
      dataJson: {
        vendedores: [
          { nome: "João", cpf: "529.982.247-25", estado_civil: "Solteiro(a)" },
        ],
        compradores: [{ nome: "Maria", cpf: "453.178.287-91" }],
        pagamento: {
          valor_total: 500000,
          sinal_arras: 250000,
          recursos_proprios: 250000,
          fgts: 0,
          cessao_consorcio: 0,
          alienacao_fiduciaria: 0,
          outras_formas: 0,
        },
        config: { multa_penal_moratoria: "10%" },
        assinatura: { cidade: "São Paulo", data: "2026-04-10" },
      },
    } as any);
    mockPrisma.contract.update.mockResolvedValueOnce({} as any);
    mockPrisma.contractChangeLog.create.mockResolvedValueOnce({} as any);

    const res = await POST(createRequest(), { params: { id: "test-id" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("aprovado");
    expect(mockPrisma.contract.update).toHaveBeenCalledWith({
      where: { id: "test-id" },
      data: { status: "aprovado" },
    });
  });

  it("creates changelog on approval", async () => {
    mockAuth.mockResolvedValueOnce(
      createMockSession({ id: "user-1", name: "Admin" })
    );
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "test-id",
      status: "rascunho",
      dataJson: {
        vendedores: [
          { nome: "João", cpf: "529.982.247-25", estado_civil: "Solteiro(a)" },
        ],
        compradores: [{ nome: "Maria", cpf: "453.178.287-91" }],
        pagamento: {
          valor_total: 500000,
          sinal_arras: 250000,
          recursos_proprios: 250000,
          fgts: 0,
          cessao_consorcio: 0,
          alienacao_fiduciaria: 0,
          outras_formas: 0,
        },
        config: { multa_penal_moratoria: "10%" },
        assinatura: { cidade: "São Paulo", data: "2026-04-10" },
      },
    } as any);
    mockPrisma.contract.update.mockResolvedValueOnce({} as any);
    mockPrisma.contractChangeLog.create.mockResolvedValueOnce({} as any);

    await POST(createRequest(), { params: { id: "test-id" } });

    expect(mockPrisma.contractChangeLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contractId: "test-id",
          action: "status_change",
          source: "user",
          details: expect.objectContaining({
            previousStatus: "rascunho",
            newStatus: "aprovado",
          }),
        }),
      })
    );
  });
});
