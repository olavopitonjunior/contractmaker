import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/proposals/public-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/proposals/public-upload")>();
  return { ...actual, resolvePublicUploadScope: vi.fn() };
});
vi.mock("@/lib/storage/s3", () => ({
  downloadBufferFromUrl: vi.fn(),
  deleteFromStorage: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/security/ratelimit", () => ({
  RateLimits: { proposalAttachmentPerToken: vi.fn().mockResolvedValue({ success: true }) },
}));
vi.mock("@/lib/proposals/notify-proposal", () => ({
  notifyProposalMilestone: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { resolvePublicUploadScope } from "@/lib/proposals/public-upload";
import { downloadBufferFromUrl, deleteFromStorage } from "@/lib/storage/s3";
import { RateLimits } from "@/lib/security/ratelimit";
import { notifyProposalMilestone } from "@/lib/proposals/notify-proposal";

const mockScope = vi.mocked(resolvePublicUploadScope);
const mockDownload = vi.mocked(downloadBufferFromUrl);
const mockDelete = vi.mocked(deleteFromStorage);
const mockRl = vi.mocked(RateLimits.proposalAttachmentPerToken);
const mockNotify = vi.mocked(notifyProposalMilestone);
const attFindFirst = prisma.proposalAttachment.findFirst as unknown as ReturnType<typeof vi.fn>;
const attCount = prisma.proposalAttachment.count as unknown as ReturnType<typeof vi.fn>;
const attCreate = prisma.proposalAttachment.create as unknown as ReturnType<typeof vi.fn>;
const dealFindFirst = prisma.dealAttachment.findFirst as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;

const BLOB_URL =
  "https://abc123.public.blob.vercel-storage.com/proposal-attachments/public/1234-rg.pdf";
const PDF = Buffer.from(`%PDF-1.7\n${"x".repeat(300)}`);

const SCOPE = {
  proposalId: "p1",
  orgId: "org1",
  userId: "owner1",
  status: "enviada",
  dataJson: { locatarios: [{ nome: "Maria" }], garantia: { tipo: "fiador", fiador: { nome: "F" } } },
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/public/proposals/tok1/attachments/finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
  });
}
const params = { params: { token: "tok1" } };
const valid = { url: BLOB_URL, filename: "rg.pdf", mime: "application/pdf" };

/** HEAD do objeto no Blob (pré-checagem de tamanho). Default: sem Content-Length. */
function stubHead(contentLength: number | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(contentLength == null ? {} : { "content-length": String(contentLength) }),
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  stubHead(null);
  mockScope.mockResolvedValue({ ok: true, scope: SCOPE } as never);
  mockRl.mockResolvedValue({ success: true } as never);
  mockDownload.mockResolvedValue(PDF);
  mockDelete.mockResolvedValue(true as never);
  attFindFirst.mockResolvedValue(null);
  dealFindFirst.mockResolvedValue(null);
  attCount.mockResolvedValue(0);
  attCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "att-1",
    createdAt: new Date("2026-09-04T12:00:00Z"),
    ...data,
  }));
  eventCreate.mockResolvedValue({});
});

describe("POST /api/public/proposals/[token]/attachments/finalize — o que a rota RECUSA", () => {
  it("token inválido → 404 genérico, sem tocar no storage", async () => {
    mockScope.mockResolvedValue({ ok: false, reason: "not_found" } as never);
    const res = await POST(req(valid), params);
    expect(res.status).toBe(404);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(attCreate).not.toHaveBeenCalled();
  });

  it.each(["blocked", "closed", "expired", "kind", "feature_off"] as const)(
    "proposta que não aceita documentos (%s) → 403",
    async (reason) => {
      mockScope.mockResolvedValue({ ok: false, reason } as never);
      const res = await POST(req(valid), params);
      expect(res.status).toBe(403);
      expect(attCreate).not.toHaveBeenCalled();
    }
  );

  it("rate limit estourado → 429 antes de ler o body", async () => {
    mockRl.mockResolvedValue({ success: false } as never);
    const res = await POST(req(valid), params);
    expect(res.status).toBe(429);
    expect(attCreate).not.toHaveBeenCalled();
  });

  it("MIME fora da allowlist → 400", async () => {
    const res = await POST(req({ ...valid, mime: "application/zip" }), params);
    expect(res.status).toBe(400);
  });

  it("URL fora da árvore pública (prefixo interno da proposta) → 403", async () => {
    const res = await POST(
      req({ ...valid, url: "https://abc.public.blob.vercel-storage.com/proposal-attachments/p1/x.pdf" }),
      params
    );
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("URL de host externo → 403", async () => {
    const res = await POST(req({ ...valid, url: "https://evil.example/proposal-attachments/public/x.pdf" }), params);
    expect(res.status).toBe(403);
  });

  it("URL já reivindicada por outro anexo (proposta ou negócio) → 409", async () => {
    dealFindFirst.mockResolvedValue({ id: "da-1" });
    const res = await POST(req(valid), params);
    expect(res.status).toBe(409);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("teto de 20 documentos do lead → 409 e o blob novo é removido", async () => {
    attCount.mockResolvedValue(20);
    const res = await POST(req(valid), params);
    expect(res.status).toBe(409);
    expect(mockDelete).toHaveBeenCalledWith(BLOB_URL);
    expect(attCreate).not.toHaveBeenCalled();
  });

  it("Content-Length acima do teto → 413 SEM baixar o corpo, blob removido", async () => {
    stubHead(21 * 1024 * 1024);
    const res = await POST(req(valid), params);
    expect(res.status).toBe(413);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(BLOB_URL);
  });

  it("magic bytes não batem com o MIME → 400 e o blob é removido", async () => {
    mockDownload.mockResolvedValue(Buffer.from("MZ executavel renomeado"));
    const res = await POST(req(valid), params);
    expect(res.status).toBe(400);
    expect(mockDelete).toHaveBeenCalledWith(BLOB_URL);
    expect(attCreate).not.toHaveBeenCalled();
  });

  it("conteúdo vazio → 400 e o blob é removido", async () => {
    mockDownload.mockResolvedValue(Buffer.alloc(0));
    const res = await POST(req(valid), params);
    expect(res.status).toBe(400);
    expect(mockDelete).toHaveBeenCalledWith(BLOB_URL);
  });
});

describe("POST finalize — o que a rota ACEITA", () => {
  it("cria o anexo com source public, parte escolhida como humana, evento público e sino do dono", async () => {
    const res = await POST(req({ ...valid, assignment: { kind: "fiador", index: 0 } }), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("att-1");
    expect(body.assignment).toEqual({ kind: "fiador", index: 0 });
    // sem URL do blob na resposta
    expect(body.url).toBeUndefined();

    const data = attCreate.mock.calls[0][0].data;
    expect(data.source).toBe("public");
    expect(data.category).toBe("documento");
    expect(data.status).toBe("awaiting_user");
    expect(data.extractedData).toEqual({ assignment: { kind: "fiador", index: 0 }, assignmentPersisted: true });

    const ev = eventCreate.mock.calls[0][0].data;
    expect(ev.eventName).toBe("document_uploaded");
    expect(ev.source).toBe("public");
    expect(typeof ev.ipHash).toBe("string");
    expect(ev.ipHash).not.toContain("203.0.113.9");

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", userId: "owner1", kind: "documents_received" })
    );
    expect(mockNotify.mock.calls[0][0].dedupeSuffix).toMatch(/^\d{10}$/);
  });

  it("atribuição inválida para o lead (locador) cai no locatário 1 — nunca 400", async () => {
    const res = await POST(req({ ...valid, assignment: { kind: "locador", index: 0 } }), params);
    expect(res.status).toBe(201);
    expect((await res.json()).assignment).toEqual({ kind: "locatario", index: 0 });
  });

  it("byte-idêntico a documento da IMOBILIÁRIA → dedup SEM mover o anexo interno (vetor do review)", async () => {
    const update = prisma.proposalAttachment.update as unknown as ReturnType<typeof vi.fn>;
    attFindFirst
      .mockResolvedValueOnce(null) // claim por url
      .mockResolvedValueOnce({
        id: "att-interno",
        source: "manual",
        url: "https://abc.public.blob.vercel-storage.com/proposal-attachments/p1/rg.pdf",
        filename: "rg.pdf",
        mime: "application/pdf",
        status: "ready",
        createdAt: new Date(),
        extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: true, fields: { a: 1 } },
      });
    const res = await POST(req({ ...valid, assignment: { kind: "fiador", index: 0 } }), params);
    expect(res.status).toBe(201);
    expect((await res.json()).deduped).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(attCreate).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(BLOB_URL);
  });

  it("mesmo conteúdo já enviado → deduped, blob novo removido, sem evento nem sino", async () => {
    attFindFirst
      .mockResolvedValueOnce(null) // claim por url
      .mockResolvedValueOnce({
        id: "att-old",
        source: "public",
        url: "https://abc.public.blob.vercel-storage.com/proposal-attachments/public/old.pdf",
        filename: "rg.pdf",
        mime: "application/pdf",
        status: "ready",
        createdAt: new Date(),
        extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: true },
      });
    const res = await POST(req(valid), params);
    expect(res.status).toBe(201);
    expect((await res.json()).deduped).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith(BLOB_URL);
    expect(eventCreate).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
