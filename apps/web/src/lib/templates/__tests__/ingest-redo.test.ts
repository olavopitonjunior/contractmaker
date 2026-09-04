import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * `reuse` — refazer a padronização na MESMA linha. O que se prova, na ordem
 * que importa: hash divergente aborta ANTES do upload; falha do Drive deixa a
 * linha e o Doc antigo intactos; no sucesso a linha aponta para o Doc novo, o
 * relatório é substituído com `redo`, e o Doc antigo só vai para a lixeira
 * DEPOIS de tudo gravado.
 */
const uploadMock = vi.fn();
vi.mock("@/lib/google/upload-file-as-gdoc", () => ({
  uploadFileAsGoogleDoc: (...a: unknown[]) => uploadMock(...a),
}));
const aiMock = vi.fn();
vi.mock("@/lib/templates/ai-placeholder-insertion", () => ({
  insertPlaceholdersWithAI: (...a: unknown[]) => aiMock(...a),
}));
vi.mock("@/lib/extraction/locacao-extractor", () => ({
  extractLocacaoContractDataJson: vi.fn(),
}));
const docTextMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: (...a: unknown[]) => docTextMock(...a),
  exportDocAsPdf: vi.fn(),
}));
vi.mock("@/lib/google/client", () => ({ getDocsClient: () => ({}) }));
const trashMock = vi.fn();
vi.mock("@/lib/google/org-oauth", () => ({
  trashDriveFile: (...a: unknown[]) => trashMock(...a),
}));

import {
  ingestTemplateFromDocx,
  RedoTemplateError,
  TemplateDriveUploadError,
} from "../ingest-template-from-docx";
import { computeSourceHash } from "../upload-dedup";

const order: string[] = [];
const templateUpdate = vi.fn();
const templateUpdateMany = vi.fn();
const templateFindFirst = vi.fn();
const templateCreate = vi.fn();
const templateDelete = vi.fn();
const transaction = vi.fn();

const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(40).fill(0x41)]);
const HASH = computeSourceHash(buffer);

function existing(over: Record<string, unknown> = {}) {
  return {
    id: "tpl1",
    name: "Residencial Caução",
    engine: "google_docs",
    status: "draft",
    sourceHash: HASH,
    googleTemplateDocId: "doc-old",
    draftReport: { inserted: [], redo: { at: "2026-09-01T00:00:00.000Z", previousDocId: "doc-0", count: 1 } },
    ...over,
  };
}

const base = {
  orgId: "org1",
  buffer,
  filename: "modelo.docx",
  modalidade: "locacao",
  reuse: { templateId: "tpl1" },
};

function lastDraftReport(): Record<string, unknown> | undefined {
  const calls = templateUpdate.mock.calls.filter((c) => c[0]?.data?.draftReport);
  return calls.at(-1)?.[0].data.draftReport as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  Object.assign(prisma.contractTemplate, {
    findFirst: templateFindFirst.mockResolvedValue(existing()),
    findMany: vi.fn().mockResolvedValue([]),
    create: templateCreate,
    update: templateUpdate.mockImplementation(async () => {
      order.push("update");
      return {};
    }),
    updateMany: templateUpdateMany.mockImplementation(async () => {
      order.push("swap");
      return { count: 1 };
    }),
    delete: templateDelete.mockResolvedValue({}),
  });
  Object.assign(prisma, { $transaction: transaction });
  uploadMock.mockResolvedValue({ docId: "doc-new", webViewLink: "http://view", embedLink: "http://embed" });
  aiMock.mockResolvedValue({
    inserted: [],
    skippedAmbiguous: [],
    notMapped: [],
    missingRequired: [],
    ranAt: "2026-09-04T00:00:00.000Z",
    docTruncated: false,
    responseTruncated: false,
    responseUnparsed: false,
  });
  docTextMock.mockResolvedValue("Locador {{locadores_qualificacao}}. Aluguel {{aluguel_valor}}.");
  trashMock.mockImplementation(async () => {
    order.push("trash");
    return true;
  });
});

describe("ingestTemplateFromDocx — reuse (refazer padronização)", () => {
  it("hash divergente → SOURCE_MISMATCH antes de qualquer upload ou escrita", async () => {
    templateFindFirst.mockResolvedValue(existing({ sourceHash: "outro" }));
    await expect(ingestTemplateFromDocx(base)).rejects.toMatchObject({
      name: "RedoTemplateError",
      code: "SOURCE_MISMATCH",
      status: 409,
    });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(templateUpdate).not.toHaveBeenCalled();
    expect(trashMock).not.toHaveBeenCalled();
  });

  it("modelo ativo → TEMPLATE_ACTIVE; modelo de outra org/inexistente → TEMPLATE_NOT_FOUND", async () => {
    templateFindFirst.mockResolvedValue(existing({ status: "active" }));
    await expect(ingestTemplateFromDocx(base)).rejects.toBeInstanceOf(RedoTemplateError);
    templateFindFirst.mockResolvedValue(null);
    await expect(ingestTemplateFromDocx(base)).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    // O escopo é da QUERY: id + org.
    expect(templateFindFirst.mock.calls[0][0].where).toEqual({ id: "tpl1", orgId: "org1" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("nunca passa pelo claim: sem transação, sem create, sem dedup", async () => {
    await ingestTemplateFromDocx(base);
    expect(transaction).not.toHaveBeenCalled();
    expect(templateCreate).not.toHaveBeenCalled();
  });

  it("Drive falha → TemplateDriveUploadError; a linha e o Doc antigo ficam como estavam", async () => {
    uploadMock.mockRejectedValue(new Error("quota"));
    await expect(ingestTemplateFromDocx(base)).rejects.toBeInstanceOf(TemplateDriveUploadError);
    expect(templateDelete).not.toHaveBeenCalled();
    expect(templateUpdate).not.toHaveBeenCalled();
    expect(trashMock).not.toHaveBeenCalled();
  });

  it("gravar o Doc novo na linha falha → o Doc NOVO vai para a lixeira, o antigo não; erro sobe", async () => {
    templateUpdateMany.mockRejectedValueOnce(new Error("db down"));
    await expect(ingestTemplateFromDocx(base)).rejects.toThrow("db down");
    expect(trashMock).toHaveBeenCalledTimes(1);
    expect(trashMock).toHaveBeenCalledWith("doc-new", "org1");
    expect(templateDelete).not.toHaveBeenCalled();
    expect(templateUpdate).not.toHaveBeenCalled();
  });

  it("dois redos concorrentes: o perdedor do CAS (count 0) joga o próprio Doc fora e recebe REDO_CONCURRENT", async () => {
    templateUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ingestTemplateFromDocx(base)).rejects.toMatchObject({
      code: "REDO_CONCURRENT",
      status: 409,
    });
    // O CAS compara com o Doc LIDO, não só com o id.
    expect(templateUpdateMany.mock.calls[0][0].where).toEqual({
      id: "tpl1",
      googleTemplateDocId: "doc-old",
    });
    expect(trashMock).toHaveBeenCalledTimes(1);
    expect(trashMock).toHaveBeenCalledWith("doc-new", "org1");
    expect(templateUpdate).not.toHaveBeenCalled();
  });

  it("relatório final não persiste → o Doc antigo FICA (não vai para a lixeira)", async () => {
    // A última escrita é a do draftReport; as anteriores (declaração de
    // slot, quando há) não existem aqui — sem slot pedido, o único update é o
    // do relatório.
    templateUpdate.mockRejectedValueOnce(new Error("db down"));
    const res = await ingestTemplateFromDocx(base);
    expect(res.docId).toBe("doc-new");
    expect(trashMock).not.toHaveBeenCalled();
  });

  it("sucesso: linha aponta para o Doc novo, relatório substituído com redo, antigo para a lixeira por último", async () => {
    const res = await ingestTemplateFromDocx(base);
    expect(res).toMatchObject({ templateId: "tpl1", name: "Residencial Caução", docId: "doc-new" });

    // Troca do Doc por CAS: volta a rascunho, zera declaração e relatório.
    const swap = templateUpdateMany.mock.calls[0][0];
    expect(swap.where).toEqual({ id: "tpl1", googleTemplateDocId: "doc-old" });
    expect(swap.data).toMatchObject({ googleTemplateDocId: "doc-new", status: "draft" });
    expect(swap.data.handlebarsSource).toContain("engine=google_docs");
    expect(swap.data.draftReport.redo).toMatchObject({ previousDocId: "doc-old", count: 2 });

    // Relatório final: o do pipeline NOVO + redo; nada do relatório antigo.
    const report = lastDraftReport();
    expect(report?.redo).toMatchObject({ previousDocId: "doc-old", count: 2 });
    expect(report?.pii).toBeDefined();

    // O antigo só sai depois da última escrita na linha.
    expect(trashMock).toHaveBeenCalledTimes(1);
    expect(trashMock).toHaveBeenCalledWith("doc-old", "org1");
    expect(order.lastIndexOf("update")).toBeLessThan(order.indexOf("trash"));
    expect(order.indexOf("swap")).toBeLessThan(order.indexOf("update"));
    expect(templateDelete).not.toHaveBeenCalled();
  });
});
