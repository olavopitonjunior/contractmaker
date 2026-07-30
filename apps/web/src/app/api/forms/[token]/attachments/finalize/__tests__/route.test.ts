import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { resolveFormScope } from "@/lib/forms/resolve-form-scope";
import { downloadBufferFromUrl, deleteFromStorage } from "@/lib/storage/s3";

/**
 * O upload do formulário passou a ser client-direct pro Blob pra remover o teto
 * de ~4.5MB de corpo de função da Vercel. Com isso o servidor deixou de ver os
 * bytes no caminho da requisição — e as checagens que dependiam deles migraram
 * pra cá. Estes testes existem pra garantir que nenhuma delas se perdeu no
 * caminho.
 */

vi.mock("@/lib/forms/resolve-form-scope", () => ({
  resolveFormScope: vi.fn(),
  formLockedResponse: vi.fn(() => null),
}));

vi.mock("@/lib/forms/form-gate", () => ({
  formClosedResponse: vi.fn(async () => null),
  viewerIsOrgMember: vi.fn(async () => false),
}));

vi.mock("@/lib/storage/s3", () => ({
  downloadBufferFromUrl: vi.fn(),
  deleteFromStorage: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

const mockPrisma = vi.mocked(prisma);
const mockScope = vi.mocked(resolveFormScope);
const mockDownload = vi.mocked(downloadBufferFromUrl);
const mockDeleteStorage = vi.mocked(deleteFromStorage);

const BLOB_URL =
  "https://abc123.public.blob.vercel-storage.com/form-attachments/1234-cnh.pdf";
const PDF = Buffer.from(`%PDF-1.7\n${"x".repeat(300)}`);

function req(body: unknown) {
  return new NextRequest("http://localhost/api/forms/tok1/attachments/finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { token: "tok1" };
const validBody = {
  url: BLOB_URL,
  filename: "cnh.pdf",
  mime: "application/pdf",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockScope.mockResolvedValue({
    formId: "form1",
    orgId: "org1",
    participantId: null,
    role: null,
    partyIndex: null,
    schemaType: "compra_venda_v1",
    lockedAt: null,
    completedAt: null,
    reopenedAt: null,
    status: "rascunho",
  } as never);
  mockDownload.mockResolvedValue(PDF);
  mockPrisma.formAttachment.findFirst.mockResolvedValue(null as never);
  mockPrisma.dealAttachment.findFirst.mockResolvedValue(null as never);
  mockPrisma.formAttachment.create.mockResolvedValue({
    id: "att1",
    filename: "cnh.pdf",
    mime: "application/pdf",
    url: BLOB_URL,
    category: null,
    status: "awaiting_user",
    createdAt: new Date("2026-07-30"),
  } as never);
});

describe("finalize — posse do objeto", () => {
  it("recusa URL fora do nosso store (SSRF/exfil pelo proxy de anexos)", async () => {
    const res = await POST(
      req({ ...validBody, url: "https://evil.example.com/form-attachments/x.pdf" }),
      { params }
    );
    expect(res.status).toBe(403);
    expect(mockPrisma.formAttachment.create).not.toHaveBeenCalled();
  });

  it("recusa objeto fora da árvore de formulários", async () => {
    const res = await POST(
      req({
        ...validBody,
        url: "https://abc.public.blob.vercel-storage.com/deal-attachments/d1/x.pdf",
      }),
      { params }
    );
    expect(res.status).toBe(403);
    expect(mockPrisma.formAttachment.create).not.toHaveBeenCalled();
  });

  it("recusa URL já reivindicada por outro anexo (roubo de documento alheio)", async () => {
    // O cliente escolhe o pathname, então o prefixo sozinho não prova posse:
    // quem tivesse ESTE token poderia informar a URL do documento de outro
    // formulário. O que fecha é o objeto ter que ser um upload novo.
    mockPrisma.formAttachment.findFirst.mockResolvedValue({ id: "outro" } as never);
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(409);
    expect(mockPrisma.formAttachment.create).not.toHaveBeenCalled();
  });

  it("recusa também quando quem reivindicou foi um DealAttachment", async () => {
    mockPrisma.dealAttachment.findFirst.mockResolvedValue({ id: "deal-att" } as never);
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(409);
  });
});

describe("finalize — validações que dependiam dos bytes", () => {
  it("magic bytes: conteúdo que não casa com o mime é rejeitado E removido do storage", async () => {
    // Executável renomeado pra .pdf. Sem esta checagem ele ficaria hospedado
    // numa URL pública nossa e seria servido pelo proxy de anexos.
    mockDownload.mockResolvedValue(Buffer.from("MZ\x90\x00 fake exe"));
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(400);
    expect(mockDeleteStorage).toHaveBeenCalledWith(BLOB_URL);
    expect(mockPrisma.formAttachment.create).not.toHaveBeenCalled();
  });

  it("acima de 20MB: rejeita e remove do storage", async () => {
    mockDownload.mockResolvedValue(Buffer.alloc(21 * 1024 * 1024, 0x41));
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(413);
    expect(mockDeleteStorage).toHaveBeenCalledWith(BLOB_URL);
  });

  it("conteúdo vazio: rejeita e remove do storage", async () => {
    mockDownload.mockResolvedValue(Buffer.alloc(0));
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(400);
    expect(mockDeleteStorage).toHaveBeenCalledWith(BLOB_URL);
  });

  it("mime fora da allowlist é rejeitado antes de baixar", async () => {
    const res = await POST(
      req({ ...validBody, mime: "application/x-msdownload" }),
      { params }
    );
    expect(res.status).toBe(400);
    expect(mockDownload).not.toHaveBeenCalled();
  });
});

describe("finalize — caminho feliz", () => {
  it("cria o anexo e devolve o shape que o card espera", async () => {
    const res = await POST(req(validBody), { params });
    const body = await res.json();

    expect(res.status).toBe(201);
    // `fileUrl` (proxy) e não a URL do Blob — é o que o DocumentosStep consome.
    expect(body.fileUrl).toBe("/api/forms/tok1/attachments/att1/file");
    expect(body).toMatchObject({ id: "att1", cached: false, status: "awaiting_user" });
    expect(mockDeleteStorage).not.toHaveBeenCalled();

    const created = mockPrisma.formAttachment.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      formId: "form1",
      filename: "cnh.pdf",
      url: BLOB_URL,
      byteSize: PDF.byteLength,
      status: "awaiting_user",
    });
    expect(created.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("cache de OCR por conteúdo: nasce ready e não gasta Gemini", async () => {
    mockPrisma.formAttachment.findFirst.mockImplementation((async (args: {
      where?: { url?: string };
    }) => {
      // A 1ª chamada é o check de posse (por url); a 2ª é o cache por hash.
      if (args?.where?.url) return null;
      return { category: "cnh", extractedData: { fields: { nome: "X" } } };
    }) as never);

    await POST(req(validBody), { params });

    const created = mockPrisma.formAttachment.create.mock.calls[0][0].data;
    expect(created.status).toBe("ready");
    expect(created.category).toBe("cnh");
  });
});
