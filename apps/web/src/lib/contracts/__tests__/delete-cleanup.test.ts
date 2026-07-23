import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  countBlobUrlReferences,
  deleteBlobIfUnreferenced,
} from "../delete-cleanup";

// Só o storage é mockado — os helpers recebem `db` por parâmetro, então
// montamos um fake com os 5 delegates de attachment que o ref-count consulta.
const deleteFromStorage = vi.fn();
vi.mock("@/lib/storage/s3", () => ({
  deleteFromStorage: (...args: unknown[]) => deleteFromStorage(...args),
}));

type Counts = Partial<{
  deal: number;
  form: number;
  proposal: number;
  lease: number;
  lead: number;
  envelope: number;
  inspection: number;
  chat: number;
}>;

function makeDb(counts: Counts) {
  return {
    dealAttachment: { count: vi.fn().mockResolvedValue(counts.deal ?? 0) },
    formAttachment: { count: vi.fn().mockResolvedValue(counts.form ?? 0) },
    proposalAttachment: { count: vi.fn().mockResolvedValue(counts.proposal ?? 0) },
    leaseClientAttachment: { count: vi.fn().mockResolvedValue(counts.lease ?? 0) },
    leadAttachment: { count: vi.fn().mockResolvedValue(counts.lead ?? 0) },
    envelope: { count: vi.fn().mockResolvedValue(counts.envelope ?? 0) },
    inspection: { count: vi.fn().mockResolvedValue(counts.inspection ?? 0) },
    chatAttachment: { count: vi.fn().mockResolvedValue(counts.chat ?? 0) },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteFromStorage.mockResolvedValue(true);
});

describe("deleteBlobIfUnreferenced (ref-count guard)", () => {
  // O bug: finalize do form copia FormAttachment.url pro DealAttachment.url
  // (mesmo blob). Deletar uma row apagava o arquivo da irmã → matrícula/IPTU
  // davam 404 no download. O guard só apaga quando o ref-count zera.
  it("mantém o blob quando outra tabela ainda o referencia", async () => {
    const db = makeDb({ form: 1 }); // FormAttachment ainda aponta pra esse blob
    const outcome = await deleteBlobIfUnreferenced(db, "https://blob.test/x.pdf");
    expect(outcome).toBe("kept");
    expect(deleteFromStorage).not.toHaveBeenCalled();
  });

  it("mantém o blob quando um Envelope ainda o referencia (PDF assinado espelhado)", async () => {
    // signed-pdf.ts grava Envelope.signedDocumentUrl E cria DealAttachment com a
    // MESMA url. Deletar o anexo espelho não pode apagar o contrato assinado.
    const db = makeDb({ envelope: 1 });
    const outcome = await deleteBlobIfUnreferenced(db, "https://blob.test/signed.pdf");
    expect(outcome).toBe("kept");
    expect(deleteFromStorage).not.toHaveBeenCalled();
  });

  it("mantém o blob quando um laudo de vistoria (Inspection) o referencia", async () => {
    const db = makeDb({ inspection: 1 });
    expect(await deleteBlobIfUnreferenced(db, "https://blob.test/laudo.pdf")).toBe("kept");
    expect(deleteFromStorage).not.toHaveBeenCalled();
  });

  it("apaga o blob só quando nenhuma row o referencia", async () => {
    const db = makeDb({}); // todas as tabelas em zero
    const outcome = await deleteBlobIfUnreferenced(db, "https://blob.test/x.pdf");
    expect(outcome).toBe("deleted");
    expect(deleteFromStorage).toHaveBeenCalledWith("https://blob.test/x.pdf");
  });

  it("url vazia/nula => skipped, sem tocar no storage", async () => {
    expect(await deleteBlobIfUnreferenced(makeDb({}), "")).toBe("skipped");
    expect(await deleteBlobIfUnreferenced(makeDb({}), null)).toBe("skipped");
    expect(deleteFromStorage).not.toHaveBeenCalled();
  });

  it("storage retornando false => skipped (não conta como deleted)", async () => {
    deleteFromStorage.mockResolvedValue(false);
    const outcome = await deleteBlobIfUnreferenced(makeDb({}), "https://blob.test/x.pdf");
    expect(outcome).toBe("skipped");
  });
});

describe("countBlobUrlReferences", () => {
  it("soma as referências de todas as tabelas (attachments + envelope/inspection/chat)", async () => {
    const db = makeDb({
      deal: 2,
      form: 1,
      proposal: 0,
      lease: 1,
      lead: 0,
      envelope: 1,
      inspection: 1,
      chat: 0,
    });
    expect(await countBlobUrlReferences(db, "https://blob.test/x.pdf")).toBe(6);
  });

  it("url vazia => 0 sem consultar o banco", async () => {
    const db = makeDb({ deal: 5 });
    expect(await countBlobUrlReferences(db, "")).toBe(0);
  });
});
