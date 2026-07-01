import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl, deleteFromStorage } from "@/lib/storage/s3";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

vi.mock("@/lib/storage/s3", () => ({
  downloadBufferFromUrl: vi.fn(async () => Buffer.from("hello world")),
  deleteFromStorage: vi.fn(async () => true),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);
const mockDownload = vi.mocked(downloadBufferFromUrl);
const mockDelete = vi.mocked(deleteFromStorage);

const BLOB = "https://store.public.blob.vercel-storage.com";
const goodUrl = `${BLOB}/deal-attachments/d1/123-doc.pdf`;

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/deals/d1/attachments/finalize", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = { url: goodUrl, filename: "doc.pdf", mime: "application/pdf" };
const baseDeal = { id: "d1", pipeline: { orgId: "org-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
  mockDownload.mockResolvedValue(Buffer.from("hello world"));
  mockDelete.mockResolvedValue(true as never);
});

describe("POST /api/deals/[dealId]/attachments/finalize", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("404 deal inexistente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("403 cross-org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      ...baseDeal,
      pipeline: { orgId: "other-org" },
    } as never);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("403 URL de host externo (não-Blob)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    const res = await POST(
      makeReq({ ...validBody, url: "https://evil.com/deal-attachments/d1/x.pdf" }),
      { params: { dealId: "d1" } }
    );
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("403 URL de outro deal (prefixo divergente)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    const res = await POST(
      makeReq({ ...validBody, url: `${BLOB}/deal-attachments/d2/123-doc.pdf` }),
      { params: { dealId: "d1" } }
    );
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("201 happy path: cria o anexo", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.dealAttachment.findFirst.mockResolvedValue(null as never);
    mockPrisma.dealAttachment.create.mockResolvedValue({
      id: "att-1",
      filename: "doc.pdf",
      mime: "application/pdf",
      url: goodUrl,
      category: null,
      createdAt: new Date(),
    } as never);

    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("att-1");
    expect(json.deduped).toBe(false);
  });

  it("200 dedup: mesmo conteúdo não duplica e limpa o blob redundante", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.dealAttachment.findFirst.mockResolvedValue({
      id: "att-existing",
      filename: "doc.pdf",
      mime: "application/pdf",
      url: `${BLOB}/deal-attachments/d1/old-doc.pdf`,
      category: null,
      createdAt: new Date(),
    } as never);

    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("att-existing");
    expect(json.deduped).toBe(true);
    expect(mockPrisma.dealAttachment.create).not.toHaveBeenCalled();
    // Blob recém-subido (goodUrl) é redundante → removido.
    expect(mockDelete).toHaveBeenCalledWith(goodUrl);
  });
});
