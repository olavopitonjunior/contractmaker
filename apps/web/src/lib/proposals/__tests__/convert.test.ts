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
const formAttCreateMany = prisma.formAttachment.createMany as unknown as ReturnType<typeof vi.fn>;

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

  it("locação: valor do deal vem de locacao.valor_aluguel (shape da proposta)", async () => {
    pFindUnique.mockResolvedValue({
      ...BASE_PROPOSAL,
      dataJson: {
        locatarios: [{ nome: "Marcia" }],
        locacao: { valor_aluguel: 3200 },
      },
    });
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          value: 3200,
          clientName: "Marcia",
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

  it("os mesmos anexos entram no FORMULÁRIO do negócio (FormAttachment), como upload do admin, sem enfileirar OCR", async () => {
    pFindUnique.mockResolvedValue(BASE_PROPOSAL);
    attFind.mockResolvedValue([
      { filename: "rg.jpg", mime: "image/jpeg", url: "s3://rg.jpg", category: "rg", contentHash: "h1", byteSize: 100, status: "ready", extractedData: { fields: { nome: "Marcia" }, assignment: { kind: "locatario", index: 0 } }, source: "public" },
      { filename: "renda.pdf", mime: "application/pdf", url: "s3://renda.pdf", category: "comprovante_renda", contentHash: "h2", byteSize: 200, status: "awaiting_user", extractedData: null, source: "manual" },
      { filename: "ilegivel.pdf", mime: "application/pdf", url: "s3://x.pdf", category: null, contentHash: null, byteSize: null, status: "extracting", extractedData: null, source: "manual" },
    ]);
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });
    expect(formAttCreateMany).toHaveBeenCalledTimes(1);
    const rows = formAttCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(3);
    // mesmo blob, no form certo, sem participante (visível a todas as partes)
    expect(rows[0]).toMatchObject({ formId: "form1", participantId: null, url: "s3://rg.jpg", category: "rg", status: "ready" });
    expect(rows[0].extractedData).toMatchObject({ assignment: { kind: "locatario", index: 0 } });
    // status nunca vira "queued": ready/failed passam, o resto aguarda o usuário
    expect(rows[1]).toMatchObject({ status: "awaiting_user", category: "comprovante_renda" });
    expect(rows[2]).toMatchObject({ status: "awaiting_user", category: "documento" });
    expect(rows.some((r: { status: string }) => r.status === "queued" || r.status === "extracting")).toBe(false);
    // e a aba Documentos continua recebendo os mesmos 3
    expect(attCreateMany.mock.calls[0][0].data).toHaveLength(3);
  });

  it("proposta sem anexos → não toca FormAttachment nem DealAttachment", async () => {
    pFindUnique.mockResolvedValue(BASE_PROPOSAL);
    attFind.mockResolvedValue([]);
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });
    expect(formAttCreateMany).not.toHaveBeenCalled();
    expect(attCreateMany).not.toHaveBeenCalled();
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
