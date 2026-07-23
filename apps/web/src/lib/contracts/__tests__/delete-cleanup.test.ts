import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  countBlobUrlReferences,
  isBlobReferenced,
  deleteBlobIfUnreferenced,
} from "../delete-cleanup";

// Só o storage é mockado — os helpers recebem `db` por parâmetro, então
// montamos um fake com TODOS os delegates de storage que o ref-check consulta.
const deleteFromStorage = vi.fn();
vi.mock("@/lib/storage/s3", () => ({
  deleteFromStorage: (...args: unknown[]) => deleteFromStorage(...args),
}));

type Counts = Partial<{
  deal: number;
  form: number;
  proposal: number; // proposalAttachment
  lease: number;
  lead: number;
  envelope: number;
  inspection: number;
  chat: number;
  export: number;
  document: number;
  proposalDossier: number; // proposal.dossierUrl
  guarantee: number;
  insurance: number;
  dimob: number;
  branding: number;
  orgFin: number;
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
    export: { count: vi.fn().mockResolvedValue(counts.export ?? 0) },
    document: { count: vi.fn().mockResolvedValue(counts.document ?? 0) },
    proposal: { count: vi.fn().mockResolvedValue(counts.proposalDossier ?? 0) },
    guarantee: { count: vi.fn().mockResolvedValue(counts.guarantee ?? 0) },
    insurancePolicy: { count: vi.fn().mockResolvedValue(counts.insurance ?? 0) },
    dimobExport: { count: vi.fn().mockResolvedValue(counts.dimob ?? 0) },
    brandingSettings: { count: vi.fn().mockResolvedValue(counts.branding ?? 0) },
    orgFinancialSettings: { count: vi.fn().mockResolvedValue(counts.orgFin ?? 0) },
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

  it("mantém o blob quando uma coluna derivada (Export) o referencia", async () => {
    // Export.url/Proposal.dossierUrl/etc. não estavam no ref-check original — o
    // GC os apagaria. Agora o guard os cobre.
    const db = makeDb({ export: 1 });
    expect(await deleteBlobIfUnreferenced(db, "https://blob.test/export.pdf")).toBe("kept");
    expect(deleteFromStorage).not.toHaveBeenCalled();
  });

  it("mantém o blob quando é logo de branding", async () => {
    const db = makeDb({ branding: 1 });
    expect(await deleteBlobIfUnreferenced(db, "https://blob.test/logo.png")).toBe("kept");
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

  it("soma inclui as colunas derivadas novas (export/dossiê/garantia/…)", async () => {
    const db = makeDb({ export: 1, proposalDossier: 1, guarantee: 1, dimob: 2 });
    expect(await countBlobUrlReferences(db, "https://blob.test/x.pdf")).toBe(5);
  });

  it("url vazia => 0 sem consultar o banco", async () => {
    const db = makeDb({ deal: 5 });
    expect(await countBlobUrlReferences(db, "")).toBe(0);
  });
});

describe("isBlobReferenced (short-circuit)", () => {
  it("true na primeira coluna que casa", async () => {
    const db = makeDb({ insurance: 1 });
    expect(await isBlobReferenced(db, "https://blob.test/apolice.pdf")).toBe(true);
  });

  it("false quando NENHUMA coluna referencia (órfão)", async () => {
    const db = makeDb({});
    expect(await isBlobReferenced(db, "https://blob.test/orfao.pdf")).toBe(false);
  });

  it("url vazia => false sem tocar o banco", async () => {
    expect(await isBlobReferenced(makeDb({ deal: 3 }), "")).toBe(false);
  });
});
