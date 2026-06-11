import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockImport = vi.fn();
vi.mock("@/lib/services/contract-import", () => ({
  importContractFromFile: (...args: unknown[]) => mockImport(...args),
}));

vi.mock("@/lib/storage/s3", () => ({
  uploadBufferToStorage: vi.fn(async () => "https://blob/import.pdf"),
}));

import { POST } from "../route";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

const PDF_HEADER = Buffer.concat([
  Buffer.from("%PDF-1.4\n", "ascii"),
  Buffer.alloc(200, 0x20), // padding pra não cair em "muito pequeno"
]);

const DOCX_HEADER = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(200, 0x00),
]);

function makeMultipartRequest(file: File | null, title?: string) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  if (title) fd.append("title", title);
  // NextRequest aceita FormData diretamente no body (suportado pela web fetch API)
  return new NextRequest("http://localhost/api/deals/import-contract", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
  mockAuth.mockResolvedValue(createMockSession() as never);
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

describe("POST /api/deals/import-contract", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const file = new File([PDF_HEADER], "x.pdf", { type: "application/pdf" });
    const res = await POST(makeMultipartRequest(file));
    expect(res.status).toBe(401);
  });

  it("400 sem campo file", async () => {
    const res = await POST(makeMultipartRequest(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/file/i);
  });

  it("415 mime não suportado", async () => {
    const file = new File([PDF_HEADER], "x.zip", { type: "application/zip" });
    const res = await POST(makeMultipartRequest(file));
    expect(res.status).toBe(415);
  });

  it("400 quando header binário não bate com mime declarado", async () => {
    const file = new File([Buffer.from("não é PDF")], "x.pdf", {
      type: "application/pdf",
    });
    const res = await POST(makeMultipartRequest(file));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/PDF/i);
  });

  it("happy path: cria SalesForm + Deal + DealAttachment + Contract", async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue({
      id: "pipe-1",
      orgId: "org-1",
      stages: [
        { id: "stage-1", position: 0, name: "Formulário" },
        { id: "stage-2", position: 1, name: "Confecção de Contrato" },
      ],
    } as never);
    mockPrisma.salesForm.create.mockResolvedValue({
      id: "form-1",
      token: "tok-1",
    } as never);
    mockPrisma.deal.count.mockResolvedValue(0 as never);
    mockPrisma.deal.create.mockResolvedValue({
      id: "deal-1",
      title: "x",
    } as never);
    mockPrisma.dealAttachment.create.mockResolvedValue({} as never);

    mockImport.mockResolvedValue({
      contractId: "contract-1",
      googleDocId: "gdoc-1",
      googleDocUrl: "https://docs/gdoc-1",
    });

    const file = new File([PDF_HEADER], "ccv.pdf", {
      type: "application/pdf",
    });
    const res = await POST(makeMultipartRequest(file, "Venda apto"));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      dealId: "deal-1",
      contractId: "contract-1",
      googleDocUrl: "https://docs/gdoc-1",
      // Token do form pra revisão dos dados extraídos (frente deal-dados).
      formToken: "tok-1",
    });

    // SalesForm criado com status="vinculado"
    expect(mockPrisma.salesForm.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "vinculado" }),
      })
    );
    // Deal criado na stage "Confecção de Contrato"
    expect(mockPrisma.deal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stageId: "stage-2" }),
      })
    );
    // DealAttachment com category="contrato_original"
    expect(mockPrisma.dealAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "contrato_original",
          source: "upload",
        }),
      })
    );
    // Service de import chamado com buffer + mime corretos
    expect(mockImport).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMime: "application/pdf",
        sourceName: "ccv.pdf",
        manualTitle: "Venda apto",
      })
    );
  });

  it("aceita DOCX", async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue({
      id: "pipe-1",
      orgId: "org-1",
      stages: [{ id: "stage-1", position: 0, name: "Formulário" }],
    } as never);
    mockPrisma.salesForm.create.mockResolvedValue({ id: "f" } as never);
    mockPrisma.deal.count.mockResolvedValue(0 as never);
    mockPrisma.deal.create.mockResolvedValue({ id: "d" } as never);
    mockPrisma.dealAttachment.create.mockResolvedValue({} as never);
    mockImport.mockResolvedValue({
      contractId: "c",
      googleDocId: "g",
      googleDocUrl: "u",
    });

    const file = new File([DOCX_HEADER], "ccv.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const res = await POST(makeMultipartRequest(file));
    expect(res.status).toBe(201);
  });

  it("502 quando importContractFromFile falha (mas Deal/Form já existem)", async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue({
      id: "pipe-1",
      orgId: "org-1",
      stages: [{ id: "stage-1", position: 0, name: "Formulário" }],
    } as never);
    mockPrisma.salesForm.create.mockResolvedValue({ id: "f" } as never);
    mockPrisma.deal.count.mockResolvedValue(0 as never);
    mockPrisma.deal.create.mockResolvedValue({ id: "deal-1" } as never);
    mockPrisma.dealAttachment.create.mockResolvedValue({} as never);

    mockImport.mockRejectedValueOnce(new Error("Drive timeout"));

    const file = new File([PDF_HEADER], "x.pdf", {
      type: "application/pdf",
    });
    const res = await POST(makeMultipartRequest(file));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Drive timeout/);
    expect(body.dealId).toBe("deal-1");
  });
});
