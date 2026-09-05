import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { convertProposalToDeal } from "../convert";

const pFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const pUpdateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const pipelineFF = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const dealCreate = prisma.deal.create as unknown as ReturnType<typeof vi.fn>;
const formCreate = prisma.salesForm.create as unknown as ReturnType<typeof vi.fn>;
const attFind = prisma.proposalAttachment.findMany as unknown as ReturnType<typeof vi.fn>;

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

describe("convertProposalToDeal — consentimento LGPD segue para o negócio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineFF.mockResolvedValue({ id: "pipe1", stages: [{ id: "stage1", position: 0 }] });
    formCreate.mockResolvedValue({ id: "form1" });
    dealCreate.mockResolvedValue({ id: "deal1", formId: "form1" });
    attFind.mockResolvedValue([]);
    pUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("complianceJson da proposta é copiado verbatim para o Deal", async () => {
    const consent = { at: "2026-09-04T22:00:00.000Z", by: "u1", baseLegal: "protecao_credito", provider: "fichacerta" };
    pFindUnique.mockResolvedValue({ ...PROPOSAL, complianceJson: { creditConsent: consent } });
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ complianceJson: { creditConsent: consent } }) })
    );
  });

  it("sem complianceJson o Deal nasce sem a chave (não grava null)", async () => {
    pFindUnique.mockResolvedValue({ ...PROPOSAL, complianceJson: null });
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });
    const data = dealCreate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("complianceJson");
  });
});
