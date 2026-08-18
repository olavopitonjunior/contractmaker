import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    dealAttachment: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

const mockUpload = vi.fn();
const mockDeleteFromStorage = vi.fn();
vi.mock("@/lib/storage/s3", () => ({
  uploadBufferToStorage: (...args: unknown[]) => mockUpload(...args),
  deleteFromStorage: (...args: unknown[]) => mockDeleteFromStorage(...args),
  downloadBufferFromUrl: vi.fn(),
}));

import { persistFormSummaryPdf } from "../form-summary-mailer";

/**
 * O storage sobe com addRandomSuffix — a URL do blob muda a TODA geração.
 * O dedup antigo casava por URL e nunca encontrava a linha, então cada clique
 * de "Baixar PDF"/"Enviar" criava um DealAttachment duplicado no deal (achado
 * do QA de staging, 2026-08-18). Contrato atual: match por (dealId, source),
 * a linha MAIS RECENTE é atualizada com a URL nova, duplicatas do bug antigo
 * são removidas de passagem e blobs substituídos são deletados (o blob-gc é
 * report-only e não cobre form-summary/).
 */

const BUF = Buffer.from("%PDF-fake");

beforeEach(() => {
  mockFindMany.mockReset();
  mockUpdate.mockReset();
  mockCreate.mockReset();
  mockDeleteMany.mockReset();
  mockUpload.mockReset();
  mockDeleteFromStorage.mockReset().mockResolvedValue(true);
});

describe("persistFormSummaryPdf — dedup por (dealId, source)", () => {
  it("cria a linha na primeira persistência, sem deletar nada", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-abc123.pdf");
    mockFindMany.mockResolvedValue([]);

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-abc123.pdf");
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockDeleteFromStorage).not.toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dealId: "deal1", source: "form_summary" },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("atualiza a linha mais recente mesmo com URL nova e deleta o blob antigo", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-NOVA-url.pdf");
    mockFindMany.mockResolvedValue([
      { id: "att-novo", url: "https://blob/resumo-velha-url.pdf" },
    ]);

    await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "att-novo" },
      data: {
        url: "https://blob/resumo-NOVA-url.pdf",
        filename: "resumo.pdf",
        byteSize: BUF.byteLength,
        category: "resumo_formulario",
      },
    });
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockDeleteFromStorage).toHaveBeenCalledWith(
      "https://blob/resumo-velha-url.pdf"
    );
  });

  it("saneia duplicatas do bug antigo: mantém a mais recente, apaga extras e seus blobs", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-NOVA.pdf");
    mockFindMany.mockResolvedValue([
      { id: "att3", url: "https://blob/resumo-c.pdf" },
      { id: "att2", url: "https://blob/resumo-b.pdf" },
      { id: "att1", url: "https://blob/resumo-a.pdf" },
    ]);

    await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "att3" } })
    );
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["att2", "att1"] } },
    });
    const deletedBlobs = mockDeleteFromStorage.mock.calls.map((c) => c[0]);
    expect(deletedBlobs).toEqual([
      "https://blob/resumo-c.pdf",
      "https://blob/resumo-b.pdf",
      "https://blob/resumo-a.pdf",
    ]);
  });

  it("falha ao deletar blob antigo não derruba a persistência", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-NOVA.pdf");
    mockFindMany.mockResolvedValue([
      { id: "att1", url: "https://blob/resumo-velha.pdf" },
    ]);
    mockDeleteFromStorage.mockRejectedValue(new Error("storage fora"));

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-NOVA.pdf");
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});
