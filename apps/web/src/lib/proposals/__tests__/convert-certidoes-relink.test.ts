import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { convertProposalToDeal } from "../convert";

const pFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const pUpdateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const pipelineFF = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const dealCreate = prisma.deal.create as unknown as ReturnType<typeof vi.fn>;
const formCreate = prisma.salesForm.create as unknown as ReturnType<typeof vi.fn>;
const attFind = prisma.proposalAttachment.findMany as unknown as ReturnType<typeof vi.fn>;
const dealAttFind = prisma.dealAttachment.findMany as unknown as ReturnType<typeof vi.fn>;
const jobUpdateMany = prisma.certidaoJob.updateMany as unknown as ReturnType<typeof vi.fn>;

const PROPOSAL = {
  id: "p1",
  orgId: "org1",
  userId: "corretor1",
  schemaType: "locacao_residencial_v1",
  kind: "locacao",
  title: "Proposta",
  status: "completa",
  dossierUrl: "s3://dossie.pdf",
  convertedDealId: null,
  dataJson: { locatarios: [{ nome: "Maria" }], locacao: { valor_aluguel: 3200 } },
};

describe("convertProposalToDeal — certidões emitidas na proposta seguem para o negócio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineFF.mockResolvedValue({ id: "pipe1", stages: [{ id: "stage1", position: 0 }] });
    formCreate.mockResolvedValue({ id: "form1" });
    dealCreate.mockResolvedValue({ id: "deal1", formId: "form1" });
    pUpdateMany.mockResolvedValue({ count: 1 });
    pFindUnique.mockResolvedValue(PROPOSAL);
  });

  it("relinka os jobs (proposalId → dealId) e casa o PDF copiado ao job pela url", async () => {
    attFind.mockResolvedValue([
      { filename: "cndt.pdf", mime: "application/pdf", url: "s3://cndt.pdf", category: "certidao", source: "infosimples", contentHash: "h", byteSize: 10, certidaoJobId: "job-1", extractedData: null },
      { filename: "rg.jpg", mime: "image/jpeg", url: "s3://rg.jpg", category: "documento", source: "manual", contentHash: "h2", byteSize: 10, certidaoJobId: null, extractedData: null },
    ]);
    jobUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 1 });
    dealAttFind.mockResolvedValue([{ id: "da-1", url: "s3://cndt.pdf" }]);

    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });

    expect(jobUpdateMany).toHaveBeenNthCalledWith(1, { where: { proposalId: "p1" }, data: { dealId: "deal1" } });
    expect(dealAttFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dealId: "deal1", url: { in: ["s3://cndt.pdf"] } } })
    );
    expect(jobUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "job-1", dealId: "deal1" },
      data: { attachmentId: "da-1" },
    });
  });

  it("sem jobs na proposta → só o relink (no-op), sem consulta de anexos", async () => {
    attFind.mockResolvedValue([]);
    jobUpdateMany.mockResolvedValue({ count: 0 });
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });
    expect(jobUpdateMany).toHaveBeenCalledTimes(1);
    expect(dealAttFind).not.toHaveBeenCalled();
  });
});
