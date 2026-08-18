import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    dealAttachment: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

const mockUpload = vi.fn();
vi.mock("@/lib/storage/s3", () => ({
  uploadBufferToStorage: (...args: unknown[]) => mockUpload(...args),
  downloadBufferFromUrl: vi.fn(),
}));

import { persistFormSummaryPdf } from "../form-summary-mailer";

/**
 * O storage sobe com addRandomSuffix — a URL do blob muda a TODA geração.
 * O dedup antigo casava por URL e nunca encontrava a linha, então cada clique
 * de "Baixar PDF"/"Enviar" criava um DealAttachment duplicado no deal (achado
 * do QA de staging, 2026-08-18). O contrato agora: match por (dealId, source),
 * update-in-place com a URL nova; create só quando não existe linha.
 */

const BUF = Buffer.from("%PDF-fake");

beforeEach(() => {
  mockFindFirst.mockReset();
  mockUpdate.mockReset();
  mockCreate.mockReset();
  mockUpload.mockReset();
});

describe("persistFormSummaryPdf — dedup por (dealId, source)", () => {
  it("cria a linha na primeira persistência", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-abc123.pdf");
    mockFindFirst.mockResolvedValue(null);

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-abc123.pdf");
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dealId: "deal1", source: "form_summary" },
      })
    );
  });

  it("atualiza a linha existente mesmo com URL nova do blob", async () => {
    mockUpload.mockResolvedValue("https://blob/resumo-OUTRA-url.pdf");
    mockFindFirst.mockResolvedValue({ id: "att1" });

    const url = await persistFormSummaryPdf("deal1", "form1", BUF, "resumo.pdf");

    expect(url).toBe("https://blob/resumo-OUTRA-url.pdf");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "att1" },
      data: {
        url: "https://blob/resumo-OUTRA-url.pdf",
        filename: "resumo.pdf",
        byteSize: BUF.byteLength,
        category: "resumo_formulario",
      },
    });
  });
});
