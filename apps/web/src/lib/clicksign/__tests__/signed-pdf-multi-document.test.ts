import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/security/ssrf", () => ({
  safeFetch: vi.fn(),
}));
vi.mock("@/lib/storage/s3", () => ({
  uploadBufferToStorage: vi.fn(),
}));
vi.mock("@/lib/clicksign/envelopes", () => ({
  listEnvelopeDocuments: vi.fn(),
}));
vi.mock("@/lib/clicksign/account", () => ({
  resolveClickSignCreds: vi
    .fn()
    .mockResolvedValue({ apiToken: "t", baseUrl: "https://x" }),
}));
vi.mock("@/lib/locacao/inspection-signature", () => ({
  updateInspectionSignedLaudo: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/log", () => ({ logError: vi.fn() }));

import { persistSignedPdf } from "../signed-pdf";
import { safeFetch } from "@/lib/security/ssrf";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { listEnvelopeDocuments } from "@/lib/clicksign/envelopes";
import { updateInspectionSignedLaudo } from "@/lib/locacao/inspection-signature";

type MockFn = ReturnType<typeof vi.fn>;
const safeFetchMock = safeFetch as unknown as MockFn;
const uploadMock = uploadBufferToStorage as unknown as MockFn;
const listDocsMock = listEnvelopeDocuments as unknown as MockFn;
const updateLaudoMock = updateInspectionSignedLaudo as unknown as MockFn;

const envelopeDb = prisma.envelope as unknown as Record<string, MockFn>;
const envelopeDocDb = prisma.envelopeDocument as unknown as Record<string, MockFn>;
const attachmentDb = prisma.dealAttachment as unknown as Record<string, MockFn>;

const ENVELOPE = {
  orgId: "org-1",
  dealId: "deal-1",
  clicksignId: "cs-env",
  proposalId: null,
  via: null,
  source: "contract",
  name: "Contrato de locação",
  contract: { version: 2, kind: "locacao" },
};

function pdfResponse(body: string) {
  return {
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  envelopeDb.findUnique = vi.fn().mockResolvedValue(ENVELOPE);
  envelopeDb.update = vi.fn().mockResolvedValue({});
  envelopeDocDb.findMany = vi.fn().mockResolvedValue([]);
  envelopeDocDb.count = vi.fn().mockResolvedValue(0);
  envelopeDocDb.update = vi.fn().mockResolvedValue({});
  envelopeDocDb.updateMany = vi.fn().mockResolvedValue({ count: 0 });
  attachmentDb.findFirst = vi.fn().mockResolvedValue(null);
  attachmentDb.findUnique = vi.fn().mockResolvedValue(null);
  attachmentDb.create = vi.fn().mockResolvedValue({});
  safeFetchMock.mockResolvedValue(pdfResponse("primary"));
  uploadMock.mockImplementation(async ({ key }: { key: string }) => `s3://${key}`);
});

describe("persistSignedPdf — envelope legado (sem EnvelopeDocument)", () => {
  it("mantém o caminho antigo: 1 download, contrato_assinado, laudo pelo primary", async () => {
    await persistSignedPdf("env-1", "https://clicksign/signed.pdf");

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(listDocsMock).not.toHaveBeenCalled();
    expect(envelopeDb.update).toHaveBeenCalledWith({
      where: { id: "env-1" },
      data: { signedDocumentUrl: "s3://envelopes/env-1/signed.pdf" },
    });
    // Sem documento extra, o primary continua alimentando o laudo da vistoria
    // (envelope de laudo avulso).
    expect(updateLaudoMock).toHaveBeenCalledWith(
      "env-1",
      "s3://envelopes/env-1/signed.pdf"
    );
    expect(attachmentDb.create).toHaveBeenCalledTimes(1);
    expect(attachmentDb.create.mock.calls[0][0].data).toMatchObject({
      category: "contrato_assinado",
      filename: "Contrato assinado v2.pdf",
    });
  });
});

describe("persistSignedPdf — envelope unificado (contrato + laudo)", () => {
  beforeEach(() => {
    envelopeDocDb.findMany = vi.fn().mockResolvedValue([
      {
        id: "doc-row-2",
        documentClicksignId: "cs-doc-2",
        kind: "attachment",
        sourceAttachmentId: "att-laudo",
        filename: "Laudo de vistoria (entrada).pdf",
        signedPdfUrl: null,
        position: 1,
      },
    ]);
    envelopeDocDb.count = vi.fn().mockResolvedValue(1);
    attachmentDb.findUnique = vi
      .fn()
      .mockResolvedValue({ category: "laudo_vistoria" });
    listDocsMock.mockResolvedValue({
      data: [
        { id: "cs-doc-1", links: { files: { signed: "https://cs/contrato.pdf" } } },
        { id: "cs-doc-2", links: { files: { signed: "https://cs/laudo.pdf" } } },
      ],
    });
    safeFetchMock
      .mockResolvedValueOnce(pdfResponse("primary"))
      .mockResolvedValueOnce(pdfResponse("laudo"));
  });

  it("baixa o assinado de CADA documento e espelha os dois na pasta do deal", async () => {
    await persistSignedPdf("env-1", "https://clicksign/contrato-signed.pdf");

    expect(safeFetchMock).toHaveBeenCalledTimes(2);
    expect(safeFetchMock.mock.calls[1][0]).toBe("https://cs/laudo.pdf");

    // Primary: signedDocumentUrl do envelope + anexo do contrato.
    expect(envelopeDb.update).toHaveBeenCalledWith({
      where: { id: "env-1" },
      data: { signedDocumentUrl: "s3://envelopes/env-1/signed.pdf" },
    });
    // Extra: key própria por documento + signedPdfUrl na row.
    const extraUrl = "s3://envelopes/env-1/documents/cs-doc-2/signed.pdf";
    expect(envelopeDocDb.update).toHaveBeenCalledWith({
      where: { id: "doc-row-2" },
      data: { signedPdfUrl: extraUrl },
    });

    expect(attachmentDb.create).toHaveBeenCalledTimes(2);
    expect(attachmentDb.create.mock.calls[1][0].data).toMatchObject({
      dealId: "deal-1",
      category: "documento_assinado",
      filename: "Laudo de vistoria (entrada) (assinado).pdf",
      source: "clicksign_signed",
      url: extraUrl,
    });
  });

  it("o laudoPdfUrl da vistoria recebe o PDF DO LAUDO, nunca o do contrato", async () => {
    await persistSignedPdf("env-1", "https://clicksign/contrato-signed.pdf");

    expect(updateLaudoMock).toHaveBeenCalledTimes(1);
    expect(updateLaudoMock).toHaveBeenCalledWith(
      "env-1",
      "s3://envelopes/env-1/documents/cs-doc-2/signed.pdf"
    );
  });

  it("documento extra ainda sem assinado remoto é pulado (sem erro, sem anexo)", async () => {
    listDocsMock.mockResolvedValue({
      data: [{ id: "cs-doc-1", links: { files: { signed: "https://cs/contrato.pdf" } } }],
    });

    await persistSignedPdf("env-1", "https://clicksign/contrato-signed.pdf");

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(envelopeDocDb.update).not.toHaveBeenCalled();
    expect(attachmentDb.create).toHaveBeenCalledTimes(1);
    expect(updateLaudoMock).not.toHaveBeenCalled();
  });

  it("extra já persistido (signedPdfUrl != null) não é rebaixado — idempotência", async () => {
    // O findMany do fluxo filtra `signedPdfUrl: null`; simulando a reentrega do
    // webhook, nada sobra pra baixar.
    envelopeDocDb.findMany = vi.fn().mockResolvedValue([]);

    await persistSignedPdf("env-1", "https://clicksign/contrato-signed.pdf");

    expect(listDocsMock).not.toHaveBeenCalled();
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(envelopeDocDb.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { envelopeId: "env-1", kind: "attachment", signedPdfUrl: null },
      })
    );
  });
});
