import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
  proposalFeatureGuard: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/security/rbac/check", () => ({
  can: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/ai/ocr", () => ({
  classifyAndExtract: vi.fn(),
  humanizeOcrError: (s: string) => s,
}));

import { POST } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { classifyAndExtract } from "@/lib/ai/ocr";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockOcr = vi.mocked(classifyAndExtract);
const findUnique = prisma.proposalAttachment.findUnique as unknown as ReturnType<typeof vi.fn>;
const updateMany = prisma.proposalAttachment.updateMany as unknown as ReturnType<typeof vi.fn>;

const req = () =>
  new NextRequest("http://localhost/api/proposals/p1/attachments/a1/extract", { method: "POST" });
const params = { params: { id: "p1", attachmentId: "a1" } };

const ATT = {
  id: "a1",
  proposalId: "p1",
  mime: "image/jpeg",
  url: "https://x.blob.vercel-storage.com/proposal-attachments/p1/rg.jpg",
  category: "documento",
  extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: {},
    proposal: {
      id: "p1",
      kind: "locacao",
      dataJson: { locatarios: [{ nome: "Maria Souza" }], garantia: { tipo: "caucao" } },
    },
  } as never);
  mockOcr.mockResolvedValue({
    documentType: "rg",
    fields: { nome_completo: "Maria Souza" },
    confidence: 0.9,
  } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/proposals/[id]/attachments/[attachmentId]/extract", () => {
  it("mime não OCR-ável → 415, sem claim nem Gemini", async () => {
    findUnique.mockResolvedValue({ ...ATT, mime: "application/zip" });
    const res = await POST(req(), params);
    expect(res.status).toBe(415);
    expect(updateMany).not.toHaveBeenCalled();
    expect(mockOcr).not.toHaveBeenCalled();
  });

  it("claim perdido (outra requisição já extraindo) → 409 e NÃO paga OCR", async () => {
    findUnique.mockResolvedValue(ATT);
    updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect(mockOcr).not.toHaveBeenCalled();
  });

  it("'Mover para…' feito DURANTE o OCR vence: grava a atribuição relida, não a do snapshot", async () => {
    // 1ª leitura (antes do claim): locatário 0. 2ª leitura (depois do Gemini):
    // o corretor moveu para o fiador enquanto o OCR rodava.
    findUnique
      .mockResolvedValueOnce(ATT)
      .mockResolvedValueOnce({
        extractedData: { assignment: { kind: "fiador", index: 0 }, assignmentPersisted: true },
        category: "documento",
      });
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignment).toEqual({ kind: "fiador", index: 0 });

    // A escrita final é condicionada ao claim (mesmo timestamp + status extracting).
    const write = updateMany.mock.calls[1][0];
    expect(write.where).toEqual(
      expect.objectContaining({ id: "a1", status: "extracting", extractingStartedAt: expect.any(Date) })
    );
    expect(write.where.extractingStartedAt).toEqual(updateMany.mock.calls[0][0].data.extractingStartedAt);
    expect(write.data.status).toBe("ready");
    expect(write.data.extractedData.assignment).toEqual({ kind: "fiador", index: 0 });
    expect(write.data.extractedData.assignmentPersisted).toBe(true);
    expect(write.data.extractedData.fields).toEqual({ nome_completo: "Maria Souza" });
  });

  it("completion zumbi (claim re-clamado por corrida mais nova) → 409, resultado não sobrescreve", async () => {
    findUnique.mockResolvedValueOnce(ATT).mockResolvedValueOnce({ extractedData: ATT.extractedData, category: "documento" });
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
  });

  it("falha no download → status failed só se ainda for o dono do claim", async () => {
    findUnique.mockResolvedValue(ATT);
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const res = await POST(req(), params);
    expect(res.status).toBe(502);
    const fail = updateMany.mock.calls[1][0];
    expect(fail.where).toEqual(expect.objectContaining({ id: "a1", status: "extracting" }));
    expect(fail.data.status).toBe("failed");
    expect(mockOcr).not.toHaveBeenCalled();
  });
});
