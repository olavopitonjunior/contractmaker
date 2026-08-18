import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureLocacaoAccess } from "@/lib/locacao/route-helpers";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

vi.mock("@/lib/locacao/route-helpers", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/locacao/route-helpers")>();
  return { ...orig, ensureLocacaoAccess: vi.fn() };
});
vi.mock("@/lib/storage/s3", () => ({
  downloadBufferFromUrl: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const mockAccess = vi.mocked(ensureLocacaoAccess);
const mockDownload = vi.mocked(downloadBufferFromUrl);

let POST: typeof import("../route").POST;

const params = { params: Promise.resolve({ id: "insp-1" }) };
const BLOB_URL =
  "https://abc123.public.blob.vercel-storage.com/inspections/insp-1/laudo-externo/laudo.pdf";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/locacao/inspections/insp-1/laudo/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  ({ POST } = await import("../route"));
  mockAccess.mockResolvedValue({ orgId: "org-1", userId: "u1" } as never);
  mockDownload.mockResolvedValue(Buffer.from("%PDF-1.7 conteudo do laudo"));
  p.inspection.findFirst.mockResolvedValue({ id: "insp-1", status: "rascunho" });
  p.inspection.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/locacao/inspections/[id]/laudo/upload", () => {
  it("404 quando a vistoria não existe na org", async () => {
    p.inspection.findFirst.mockResolvedValueOnce(null);
    const res = await POST(post({ url: BLOB_URL }), params);
    expect(res.status).toBe(404);
  });

  it("422 quando o laudo não é mais editável (em assinatura)", async () => {
    p.inspection.findFirst.mockResolvedValueOnce({ id: "insp-1", status: "assinatura" });
    const res = await POST(post({ url: BLOB_URL }), params);
    expect(res.status).toBe(422);
  });

  it("400 sem url no body", async () => {
    const res = await POST(post({}), params);
    expect(res.status).toBe(400);
  });

  it("403 quando a URL não é do store Blob", async () => {
    const res = await POST(post({ url: "https://evil.example.com/laudo.pdf" }), params);
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("403 quando o pathname pertence a outra vistoria", async () => {
    const res = await POST(
      post({
        url: "https://abc.public.blob.vercel-storage.com/inspections/OUTRA/laudo-externo/x.pdf",
      }),
      params
    );
    expect(res.status).toBe(403);
  });

  it("415 quando o conteúdo baixado não é PDF (magic bytes)", async () => {
    mockDownload.mockResolvedValueOnce(Buffer.from("<html>nao sou pdf</html>"));
    const res = await POST(post({ url: BLOB_URL }), params);
    expect(res.status).toBe(415);
    expect(p.inspection.updateMany).not.toHaveBeenCalled();
  });

  it("409 quando o status mudou durante o upload (TOCTOU)", async () => {
    p.inspection.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await POST(post({ url: BLOB_URL }), params);
    expect(res.status).toBe(409);
  });

  it("grava laudoOrigem=externo, zera qrToken e condiciona ao status editável", async () => {
    const res = await POST(post({ url: BLOB_URL, filename: "laudo assinado.pdf" }), params);
    expect(res.status).toBe(200);
    expect(p.inspection.updateMany).toHaveBeenCalledWith({
      where: {
        id: "insp-1",
        orgId: "org-1",
        status: { in: ["rascunho", "em_campo", "laudo_gerado"] },
      },
      data: {
        laudoPdfUrl: BLOB_URL,
        laudoOrigem: "externo",
        status: "laudo_gerado",
        qrToken: null,
      },
    });
  });
});
