import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindFirst = vi.fn();
const mockUpdateMany = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    dealAttachment: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      create: (...args: unknown[]) => mockCreate(...args),
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
 * O storage sobe com addRandomSuffix — a URL do blob muda a TODA geração; o
 * dedup antigo casava por URL e duplicava um DealAttachment por clique (QA de
 * staging, 2026-08-18). Contrato atual, sob o unique parcial
 * DealAttachment_dealId_form_summary_key: uma linha por deal; quem PERDE uma
 * corrida (update otimista count=0 ou create P2002) ADOTA o estado do vencedor
 * — deleta o próprio blob e devolve a URL vigente — em vez de sobrescrever
 * (sobrescrever órfãria o blob do vencedor com e-mail em voo apontando pra ele).
 */

const BUF = Buffer.from("%PDF-fake");

beforeEach(() => {
  mockFindFirst.mockReset();
  mockUpdateMany.mockReset();
  mockCreate.mockReset();
  mockUpload.mockReset();
  mockDeleteFromStorage.mockReset().mockResolvedValue(true);
});

describe("persistFormSummaryPdf — uma linha por deal, perdedor adota o vencedor", () => {
  it("cria a linha na primeira persistência, sem deletar nada", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-abc.pdf");
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-abc.pdf");
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeleteFromStorage).not.toHaveBeenCalled();
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dealId: "deal1", source: "form_summary" },
      })
    );
  });

  it("atualiza a linha existente com URL nova e deleta o blob antigo", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-NOVA.pdf");
    mockFindFirst.mockResolvedValue({
      id: "att1",
      url: "https://blob/resumo-velha.pdf",
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-NOVA.pdf");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "att1", url: "https://blob/resumo-velha.pdf" },
      data: {
        url: "https://blob/resumo-NOVA.pdf",
        filename: "resumo.pdf",
        byteSize: BUF.byteLength,
        category: "resumo_formulario",
      },
    });
    expect(mockDeleteFromStorage).toHaveBeenCalledWith(
      "https://blob/resumo-velha.pdf"
    );
  });

  it("corrida update-vs-update (count=0): adota o vencedor e descarta o próprio blob", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-PERDEDOR.pdf");
    mockFindFirst
      .mockResolvedValueOnce({ id: "att1", url: "https://blob/resumo-velha.pdf" })
      .mockResolvedValueOnce({ url: "https://blob/resumo-VENCEDOR.pdf" });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-VENCEDOR.pdf");
    expect(mockDeleteFromStorage).toHaveBeenCalledWith(
      "https://blob/resumo-PERDEDOR.pdf"
    );
    expect(mockDeleteFromStorage).not.toHaveBeenCalledWith(
      "https://blob/resumo-VENCEDOR.pdf"
    );
  });

  it("corrida create-vs-create (P2002 do unique parcial): adota o vencedor", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-PERDEDOR.pdf");
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ url: "https://blob/resumo-VENCEDOR.pdf" });
    mockCreate.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" })
    );

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-VENCEDOR.pdf");
    expect(mockDeleteFromStorage).toHaveBeenCalledWith(
      "https://blob/resumo-PERDEDOR.pdf"
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("erro de create que NÃO é P2002 propaga", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-x.pdf");
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue(new Error("db fora"));

    await expect(
      persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf")
    ).rejects.toThrow("db fora");
  });

  it("falha ao deletar blob antigo não derruba a persistência", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-NOVA.pdf");
    mockFindFirst.mockResolvedValue({
      id: "att1",
      url: "https://blob/resumo-velha.pdf",
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockDeleteFromStorage.mockRejectedValue(new Error("storage fora"));

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-NOVA.pdf");
  });
});
