import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    dealAttachment: { findUnique: vi.fn() },
    deal: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/ai/ocr", () => ({ extractDocumentData: vi.fn() }));
vi.mock("@/lib/ai/crosscheck/certidoes", () => ({ crossCheckCertidoes: vi.fn() }));
vi.mock("@/lib/ai/quickChecks", () => ({ dedupeKeyFor: vi.fn(() => "k") }));

import { analyzeManualCertidaoForDeal } from "../manual-certidao-analysis";
import { prisma } from "@/lib/db/prisma";

const findAttachment = vi.mocked(prisma.dealAttachment.findUnique);
const findDeal = vi.mocked(prisma.deal.findUnique);

/**
 * O guard de categoria deste serviço aceitava só `"matricula_anexada"` —
 * categoria que NENHUM produtor do repo grava (o finalize do formulário e o
 * upload manual gravam `"matricula"`). Resultado: a análise de matrícula nunca
 * rodou, desde sempre. Estes testes fixam o contrato dos dois lados: `deal`
 * consultado = passou do guard; `deal` não consultado = parou nele.
 */
describe("analyzeManualCertidaoForDeal — guard de categoria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sem contrato rascunho o serviço sai logo depois do guard, o que basta:
    // o que medimos é se ele CHEGOU a consultar o negócio.
    findDeal.mockResolvedValue(null as never);
  });

  const runWith = async (category: string | null) => {
    findAttachment.mockResolvedValue({
      id: "att1",
      dealId: "deal1",
      category,
      url: "https://blob.example/doc.pdf",
      mime: "application/pdf",
      filename: "doc.pdf",
    } as never);
    await analyzeManualCertidaoForDeal("deal1", "att1");
    return findDeal.mock.calls.length > 0;
  };

  it("'matricula' — a categoria que os produtores gravam — passa pelo guard", async () => {
    expect(await runWith("matricula")).toBe(true);
  });

  it("'matricula_anexada' (legado) continua passando", async () => {
    expect(await runWith("matricula_anexada")).toBe(true);
  });

  it("certidões seguem passando", async () => {
    expect(await runWith("certidao_onus")).toBe(true);
  });

  it("categoria alheia e nula param no guard", async () => {
    expect(await runWith("rg")).toBe(false);
    expect(await runWith(null)).toBe(false);
  });

  it("anexo de outro negócio é recusado antes do guard", async () => {
    findAttachment.mockResolvedValue({
      id: "att1",
      dealId: "OUTRO",
      category: "matricula",
      url: "https://blob.example/doc.pdf",
      mime: "application/pdf",
      filename: "doc.pdf",
    } as never);
    await analyzeManualCertidaoForDeal("deal1", "att1");
    expect(findDeal).not.toHaveBeenCalled();
  });
});
