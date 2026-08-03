import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  persistProposalDocument,
  computeContentHash,
} from "../attachments";

const findFirst = prisma.proposalAttachment.findFirst as unknown as ReturnType<typeof vi.fn>;
const create = prisma.proposalAttachment.create as unknown as ReturnType<typeof vi.fn>;

const BUF = Buffer.from("%PDF-1.4 registro do aceite");

describe("persistProposalDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "att-1",
      ...data,
    }));
  });

  it("cria o anexo com hash e tamanho derivados do buffer", async () => {
    const { attachment, deduped } = await persistProposalDocument({
      proposalId: "p1",
      buffer: BUF,
      url: "https://blob/registro.pdf",
      filename: "Registro do Aceite (ClickSign).pdf",
      mime: "application/pdf",
      category: "aceite_registro_clicksign",
      source: "clicksign_acceptance",
    });

    expect(deduped).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0][0].data;
    expect(data.proposalId).toBe("p1");
    expect(data.category).toBe("aceite_registro_clicksign");
    expect(data.source).toBe("clicksign_acceptance");
    expect(data.byteSize).toBe(BUF.byteLength);
    expect(data.contentHash).toBe(computeContentHash(BUF));
    expect(attachment.id).toBe("att-1");
  });

  it("mesmo conteúdo já anexado → devolve o existente e NÃO cria linha nova", async () => {
    // Cenário concreto: o corretor sobe o mesmo Registro duas vezes, ou o
    // webhook e o script de recuperação correm juntos.
    findFirst.mockResolvedValue({ id: "att-antigo", url: "https://blob/antigo.pdf" });

    const { attachment, deduped } = await persistProposalDocument({
      proposalId: "p1",
      buffer: BUF,
      url: "https://blob/novo.pdf",
      filename: "Registro do Aceite (ClickSign).pdf",
      mime: "application/pdf",
      source: "manual",
    });

    expect(deduped).toBe(true);
    expect(attachment.id).toBe("att-antigo");
    expect(create).not.toHaveBeenCalled();
  });

  it("dedupe é POR PROPOSTA — o mesmo arquivo em outra proposta entra normalmente", async () => {
    await persistProposalDocument({
      proposalId: "p2",
      buffer: BUF,
      url: "https://blob/x.pdf",
      filename: "doc.pdf",
      mime: "application/pdf",
      source: "manual",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { proposalId: "p2", contentHash: computeContentHash(BUF) },
    });
  });

  it("sem auditCtx (webhook/script) não tenta auditar", async () => {
    const { deduped } = await persistProposalDocument({
      proposalId: "p1",
      buffer: BUF,
      url: "https://blob/x.pdf",
      filename: "doc.pdf",
      mime: "application/pdf",
      source: "clicksign_acceptance",
    });
    expect(deduped).toBe(false);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("category ausente vira null (coluna é nullable)", async () => {
    await persistProposalDocument({
      proposalId: "p1",
      buffer: BUF,
      url: "https://blob/x.pdf",
      filename: "doc.pdf",
      mime: "application/pdf",
      source: "manual",
    });
    expect(create.mock.calls[0][0].data.category).toBeNull();
  });
});
