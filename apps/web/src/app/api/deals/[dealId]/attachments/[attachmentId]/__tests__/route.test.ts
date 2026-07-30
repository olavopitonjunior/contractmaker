import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, PATCH } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";

/**
 * Testes do DELETE de documento do negócio.
 *
 * Motivo de existirem: o guard de 409 (envelope ClickSign `closed`/`running`)
 * foi pra produção no PR #199 sem NUNCA ter sido exercitado — só verificado por
 * leitura de código. Exercitar em produção é destrutivo se o guard estiver
 * errado: apagaria um anexo com assinatura em curso. Aqui o caminho é coberto
 * sem risco, e passa a proteger contra regressão.
 */

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
  getUserOrg: vi.fn(),
}));

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({
    orgId: "org1",
    userId: "user1",
    ipAddress: null,
    userAgent: null,
  })),
}));

const mockPrisma = vi.mocked(prisma);
const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);

const ATTACHMENT = {
  id: "att1",
  dealId: "deal1",
  filename: "matricula.pdf",
  mime: "application/pdf",
  url: "https://blob.test/matricula.pdf",
  category: "matricula",
  extractedData: null,
  source: "manual",
  byteSize: 1234,
  contentHash: "abc",
  restoredFromId: null,
  createdAt: new Date("2026-07-01"),
  deal: { id: "deal1", pipeline: { orgId: "org1" } },
};

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/deals/deal1/attachments/att1", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { dealId: "deal1", attachmentId: "att1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
  mockGetUserOrg.mockResolvedValue({ id: "org1" } as never);
  mockPrisma.dealAttachment.findUnique.mockResolvedValue(ATTACHMENT as never);
  mockPrisma.envelope.findFirst.mockResolvedValue(null as never);
  (mockPrisma.deletedAttachment.create as never as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "arch1",
  });
});

describe("DELETE — guard de envelope ativo (débito do PR #199)", () => {
  it("409 quando há envelope closed, e NÃO apaga o anexo", async () => {
    mockPrisma.envelope.findFirst.mockResolvedValue({
      id: "env1",
      status: "closed",
    } as never);

    const res = await DELETE(req("DELETE"), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("concluído");
    expect(body.envelopeId).toBe("env1");
    // O ponto do guard: nada foi tocado.
    expect(mockPrisma.dealAttachment.delete).not.toHaveBeenCalled();
    expect(mockPrisma.deletedAttachment.create).not.toHaveBeenCalled();
  });

  it("409 quando há envelope running, com texto de 'em andamento'", async () => {
    mockPrisma.envelope.findFirst.mockResolvedValue({
      id: "env2",
      status: "running",
    } as never);

    const res = await DELETE(req("DELETE"), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("em andamento");
    expect(mockPrisma.dealAttachment.delete).not.toHaveBeenCalled();
  });

  it("envelope canceled não bloqueia — a query só olha closed/running", async () => {
    // `findFirst` recebe o filtro; devolver null simula "não há closed/running".
    mockPrisma.envelope.findFirst.mockResolvedValue(null as never);

    const res = await DELETE(req("DELETE"), { params });

    expect(res.status).toBe(200);
    const where = (mockPrisma.envelope.findFirst as never as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].where;
    expect(where.status.in).toEqual(["closed", "running"]);
    expect(where.attachmentId).toBe("att1");
  });
});

describe("DELETE — arquiva em vez de destruir", () => {
  it("grava DeletedAttachment e apaga a linha na MESMA transação", async () => {
    const res = await DELETE(req("DELETE"), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ deleted: true, recoverable: true });
    expect(mockPrisma.$transaction).toHaveBeenCalled();

    const archived = (
      mockPrisma.deletedAttachment.create as never as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].data;
    expect(archived).toMatchObject({
      orgId: "org1",
      origin: "deal",
      originalId: "att1",
      dealId: "deal1",
      filename: "matricula.pdf",
      url: "https://blob.test/matricula.pdf",
      deletedVia: "ui_deal",
      deletedByUserId: "user1",
    });
    // Payload completo — é o que permite restaurar depois.
    expect(archived.payload).toMatchObject({ mime: "application/pdf" });
    expect(mockPrisma.dealAttachment.delete).toHaveBeenCalledWith({
      where: { id: "att1" },
    });
  });

  it("cross-org: 403 e nada arquivado", async () => {
    mockPrisma.dealAttachment.findUnique.mockResolvedValue({
      ...ATTACHMENT,
      deal: { id: "deal1", pipeline: { orgId: "outra-org" } },
    } as never);

    const res = await DELETE(req("DELETE"), { params });

    expect(res.status).toBe(403);
    expect(mockPrisma.deletedAttachment.create).not.toHaveBeenCalled();
    expect(mockPrisma.dealAttachment.delete).not.toHaveBeenCalled();
  });
});

describe("PATCH — categorias reservadas ao sistema", () => {
  it("rejeita reclassificar pra resumo_formulario", async () => {
    // O caso concreto: `persistFormSummaryPdf` casava a linha do resumo por
    // categoria, então mover um documento pra cá o fazia ser apagado no
    // próximo envio.
    const res = await PATCH(req("PATCH", { category: "resumo_formulario" }), {
      params,
    });
    expect(res.status).toBe(400);
    expect(mockPrisma.dealAttachment.update).not.toHaveBeenCalled();
  });

  it("rejeita contrato_original e proposta_original", async () => {
    for (const category of ["contrato_original", "proposta_original"]) {
      const res = await PATCH(req("PATCH", { category }), { params });
      expect(res.status).toBe(400);
    }
    expect(mockPrisma.dealAttachment.update).not.toHaveBeenCalled();
  });

  it("aceita categoria comum", async () => {
    const res = await PATCH(req("PATCH", { category: "iptu" }), { params });
    expect(res.status).toBe(200);
    expect(mockPrisma.dealAttachment.update).toHaveBeenCalled();
  });
});
