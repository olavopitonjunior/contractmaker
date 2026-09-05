import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { persistProposalDocument } from "../attachments";

const findFirst = prisma.proposalAttachment.findFirst as unknown as ReturnType<typeof vi.fn>;
const create = prisma.proposalAttachment.create as unknown as ReturnType<typeof vi.fn>;
const update = prisma.proposalAttachment.update as unknown as ReturnType<typeof vi.fn>;

const BUF = Buffer.from("%PDF-1.4 comprovante identico");

const base = {
  proposalId: "p1",
  buffer: BUF,
  url: "https://blob/novo.pdf",
  filename: "comprovante.pdf",
  mime: "application/pdf",
  source: "manual",
  status: "awaiting_user",
};

/**
 * Cenário concreto: dois locatários com o MESMO comprovante de endereço
 * (casal). O corretor sobe o arquivo para o Locatário 1 e depois de novo para
 * o Locatário 2. O dedup por hash devolve o anexo antigo — e antes descartava
 * a parte escolhida em silêncio.
 */
describe("persistProposalDocument — dedup não descarta a escolha humana da parte", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "att-novo", ...data }));
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "att-antigo", ...data }));
  });

  it("mesmo conteúdo, parte DIFERENTE e persistida → move o anexo existente (assignmentUpdated)", async () => {
    findFirst.mockResolvedValue({
      id: "att-antigo",
      source: "manual",
      url: "https://blob/antigo.pdf",
      extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: true, fields: { x: 1 } },
    });

    const r = await persistProposalDocument({
      ...base,
      extractedData: { assignment: { kind: "locatario", index: 1 }, assignmentPersisted: true },
    });

    expect(r.deduped).toBe(true);
    expect(r.assignmentUpdated).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    const data = update.mock.calls[0][0].data.extractedData as Record<string, unknown>;
    expect(data.assignment).toEqual({ kind: "locatario", index: 1 });
    expect(data.assignmentPersisted).toBe(true);
    // campos do OCR anterior preservados
    expect(data.fields).toEqual({ x: 1 });
  });

  it("existente só com SUGESTÃO do OCR → a escolha humana agora persiste", async () => {
    findFirst.mockResolvedValue({
      id: "att-antigo",
      source: "manual",
      url: "https://blob/antigo.pdf",
      extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: false },
    });
    const r = await persistProposalDocument({
      ...base,
      extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: true },
    });
    expect(r.assignmentUpdated).toBe(true);
    expect(update.mock.calls[0][0].data.extractedData.assignmentPersisted).toBe(true);
  });

  it("mesma parte já persistida → nada a atualizar", async () => {
    findFirst.mockResolvedValue({
      id: "att-antigo",
      source: "manual",
      url: "https://blob/antigo.pdf",
      extractedData: { assignment: { kind: "fiador", index: 0 }, assignmentPersisted: true },
    });
    const r = await persistProposalDocument({
      ...base,
      extractedData: { assignment: { kind: "fiador", index: 0 }, assignmentPersisted: true },
    });
    expect(r.deduped).toBe(true);
    expect(r.assignmentUpdated).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("origem DIFERENTE (lead sobe byte-idêntico ao que a imobiliária subiu) → NÃO move o anexo interno", async () => {
    // Vetor fechado no review do PR 4: a página pública (source "public") não
    // pode reescrever a parte de um documento "manual" — o convert levaria o
    // OCR dele para onde o lead apontasse.
    findFirst.mockResolvedValue({
      id: "att-interno",
      source: "manual",
      url: "https://blob/interno.pdf",
      extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: true, fields: { x: 1 } },
    });
    const r = await persistProposalDocument({
      ...base,
      source: "public",
      extractedData: { assignment: { kind: "fiador", index: 0 }, assignmentPersisted: true },
    });
    expect(r.deduped).toBe(true);
    expect(r.assignmentUpdated).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("sem atribuição no upload (ex.: Registro do Aceite) → dedup puro, sem tocar no existente", async () => {
    findFirst.mockResolvedValue({
      id: "att-antigo",
      source: "manual",
      url: "https://blob/antigo.pdf",
      extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: true },
    });
    const r = await persistProposalDocument({ ...base, category: "aceite_registro_clicksign" });
    expect(r.deduped).toBe(true);
    expect(r.assignmentUpdated).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
