import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { convertProposalToDeal, ProposalConvertError } from "../convert";

const pFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const pUpdateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const pipelineFF = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const dealCreate = prisma.deal.create as unknown as ReturnType<typeof vi.fn>;
const formCreate = prisma.salesForm.create as unknown as ReturnType<typeof vi.fn>;
const attFind = prisma.proposalAttachment.findMany as unknown as ReturnType<typeof vi.fn>;
const attCreateMany = prisma.dealAttachment.createMany as unknown as ReturnType<typeof vi.fn>;

const BASE_PROPOSAL = {
  id: "p1",
  orgId: "org1",
  userId: "corretor1",
  schemaType: "locacao_residencial_v1",
  kind: "locacao",
  title: "Proposta Marcia",
  status: "completa",
  dossierUrl: "s3://dossie.pdf",
  convertedDealId: null,
  dataJson: { locatarios: [{ nome: "Marcia" }] },
};

describe("convertProposalToDeal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineFF.mockResolvedValue({ id: "pipe1", stages: [{ id: "stage1", position: 0 }] });
    formCreate.mockResolvedValue({ id: "form1" });
    dealCreate.mockResolvedValue({ id: "deal1", formId: "form1" });
    attFind.mockResolvedValue([]);
    pUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("herda schemaType e kind da proposta (não vira compra_venda/venda)", async () => {
    pFindUnique.mockResolvedValue(BASE_PROPOSAL);
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });

    expect(formCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ schemaType: "locacao_residencial_v1" }),
      })
    );
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "locacao",
          userId: "corretor1",
          stageId: "stage1",
          // canal de origem capturado na conversão de proposta
          sourceChannel: "proposta",
        }),
      })
    );
  });

  it("copia anexos (mesmo blob) para o deal", async () => {
    pFindUnique.mockResolvedValue(BASE_PROPOSAL);
    attFind.mockResolvedValue([
      { filename: "Dossiê.pdf", mime: "application/pdf", url: "s3://d.pdf", category: "dossie", contentHash: "h1", byteSize: 100 },
    ]);
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });
    expect(attCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ url: "s3://d.pdf", source: "proposal", dealId: "deal1" })],
        skipDuplicates: true,
      })
    );
  });

  it("proposta já convertida → erro", async () => {
    pFindUnique.mockResolvedValue({ ...BASE_PROPOSAL, convertedDealId: "deal-old" });
    await expect(
      convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" })
    ).rejects.toThrow(ProposalConvertError);
  });

  it("corrida: CAS count=0 dentro da transação → aborta", async () => {
    pFindUnique.mockResolvedValue(BASE_PROPOSAL);
    pUpdateMany.mockResolvedValue({ count: 0 }); // outro request converteu primeiro
    await expect(
      convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" })
    ).rejects.toThrow(ProposalConvertError);
  });

  it("não assinada sem allowUnsigned → bloqueia", async () => {
    pFindUnique.mockResolvedValue({ ...BASE_PROPOSAL, status: "visualizada", dossierUrl: null });
    await expect(
      convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" })
    ).rejects.toThrow(/não foi assinada/);
  });

  it("não assinada COM allowUnsigned → converte e marca convertedWithoutSignature", async () => {
    pFindUnique.mockResolvedValue({ ...BASE_PROPOSAL, status: "visualizada", dossierUrl: null });
    await convertProposalToDeal({
      proposalId: "p1",
      orgId: "org1",
      actorUserId: "x",
      allowUnsigned: true,
      unsignedReason: "cliente confirmou por telefone",
    });
    expect(pUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ convertedWithoutSignature: true, status: "convertida" }),
      })
    );
  });

  it("assinada mas dossiê ainda não pronto → bloqueia (evita deal sem anexos)", async () => {
    pFindUnique.mockResolvedValue({ ...BASE_PROPOSAL, dossierUrl: null });
    await expect(
      convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" })
    ).rejects.toThrow(/está sendo processado/);
  });

  it("cross-org: proposta de outra org → não encontrada", async () => {
    pFindUnique.mockResolvedValue({ ...BASE_PROPOSAL, orgId: "outra" });
    await expect(
      convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" })
    ).rejects.toThrow(ProposalConvertError);
  });
});
