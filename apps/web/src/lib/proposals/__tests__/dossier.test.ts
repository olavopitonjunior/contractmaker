import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/security/ssrf", () => ({ safeFetch: vi.fn() }));
vi.mock("@/lib/storage/s3", () => ({ uploadBufferToStorage: vi.fn() }));

import { safeFetch } from "@/lib/security/ssrf";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { buildDossier } from "../dossier";

const propFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const envMany = prisma.envelope.findMany as unknown as ReturnType<typeof vi.fn>;
const tx = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const fetchMock = safeFetch as unknown as ReturnType<typeof vi.fn>;
const upload = uploadBufferToStorage as unknown as ReturnType<typeof vi.fn>;

async function onePagePdfBytes(): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  return doc.save();
}

describe("buildDossier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proposta sem dossierUrl e sem envelope → empty", async () => {
    propFind.mockResolvedValue({ id: "p1", dossierUrl: null, status: "completa" });
    envMany.mockResolvedValue([]);
    expect(await buildDossier("p1")).toEqual({ skipped: "empty" });
  });

  it("dossierUrl já preenchido → already_built (não regera)", async () => {
    propFind.mockResolvedValue({ id: "p1", dossierUrl: "s3://ja.pdf", status: "completa" });
    expect(await buildDossier("p1")).toEqual({ skipped: "already_built" });
  });

  it("proposta ainda não completa (proponente assinou, falta o proprietário) → pending", async () => {
    // Gate anti-corrida: o buildDossier do envelope completo NÃO pode montar
    // antes da reduzida existir/fechar.
    propFind.mockResolvedValue({ id: "p1", dossierUrl: null, status: "aguardando_vendedor" });
    expect(await buildDossier("p1")).toEqual({ skipped: "pending" });
    expect(envMany).not.toHaveBeenCalled();
  });

  it("algum envelope sem PDF assinado → pending (espera)", async () => {
    propFind.mockResolvedValue({ id: "p1", dossierUrl: null, status: "completa" });
    envMany.mockResolvedValue([
      { id: "e1", via: "completa", signedDocumentUrl: "s3://a.pdf", status: "closed" },
      { id: "e2", via: "reduzida", signedDocumentUrl: null, status: "closed" },
    ]);
    expect(await buildDossier("p1")).toEqual({ skipped: "pending" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completa + todos assinados → merge das duas vias + cria dossiê", async () => {
    propFind.mockResolvedValue({ id: "p1", dossierUrl: null, status: "completa" });
    envMany.mockResolvedValue([
      { id: "e1", via: "completa", signedDocumentUrl: "s3://a.pdf", status: "closed" },
      { id: "e2", via: "reduzida", signedDocumentUrl: "s3://b.pdf", status: "closed" },
    ]);
    const bytes = await onePagePdfBytes();
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer });
    upload.mockResolvedValue("s3://dossie.pdf");
    tx.mockResolvedValue([]);

    const r = await buildDossier("p1");
    expect(r).toEqual({ url: "s3://dossie.pdf" });
    // Baixou as duas vias e subiu numa key estável.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ key: "proposals/p1/dossie.pdf" })
    );
    // Persistiu anexo + dossierUrl numa transação.
    expect(tx).toHaveBeenCalledTimes(1);
  });
});
