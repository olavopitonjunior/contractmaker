import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { convertProposalToDeal } from "../convert";

const pFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const pUpdateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const pipelineFF = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const dealCreate = prisma.deal.create as unknown as ReturnType<typeof vi.fn>;
const formCreate = prisma.salesForm.create as unknown as ReturnType<typeof vi.fn>;
const attFind = prisma.proposalAttachment.findMany as unknown as ReturnType<typeof vi.fn>;
const attCreateMany = prisma.dealAttachment.createMany as unknown as ReturnType<typeof vi.fn>;

const PROPOSAL = {
  id: "p1",
  orgId: "org1",
  userId: "corretor1",
  schemaType: "locacao_residencial_v1",
  kind: "locacao",
  title: "Proposta sem nome",
  status: "completa",
  dossierUrl: "s3://dossie.pdf",
  convertedDealId: null,
  // O locatário entrou SEM nome: o único lugar com o nome é o RG lido por OCR.
  dataJson: {
    locatarios: [{ tipo_pessoa: "fisica" }],
    locacao: { valor_aluguel: 3200 },
  },
};

const RG_READY = {
  id: "att-rg",
  filename: "rg.jpg",
  mime: "image/jpeg",
  url: "s3://rg.jpg",
  category: "rg",
  source: "manual",
  contentHash: "h-rg",
  byteSize: 1000,
  status: "ready",
  createdAt: new Date("2026-09-04T10:00:00Z"),
  extractedData: {
    category: "rg",
    fields: { nome_completo: "Maria Souza", cpf_numero: "529.982.247-25" },
    assignment: { kind: "locatario", index: 0 },
    assignmentPersisted: true,
  },
};

describe("convertProposalToDeal — OCR da proposta alimenta título/clientName do Deal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineFF.mockResolvedValue({ id: "pipe1", stages: [{ id: "stage1", position: 0 }] });
    formCreate.mockResolvedValue({ id: "form1" });
    dealCreate.mockResolvedValue({ id: "deal1", formId: "form1" });
    pUpdateMany.mockResolvedValue({ count: 1 });
    attCreateMany.mockResolvedValue({ count: 1 });
    pFindUnique.mockResolvedValue(PROPOSAL);
  });

  it("nome que só existe no RG lido vira clientName do Deal e nome no SalesForm (mesmo dado)", async () => {
    attFind.mockResolvedValue([RG_READY]);
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });

    // `deriveMeta` roda DEPOIS do OCR entrar no dataJson — card e formulário
    // não podem discordar.
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientName: "Maria Souza", value: 3200 }) })
    );
    const formData = formCreate.mock.calls[0][0].data.dataJson as { locatarios: Array<Record<string, unknown>> };
    expect(formData.locatarios[0].nome).toBe("Maria Souza");
    expect(formData.locatarios[0].cpf).toBe("52998224725");
  });

  it("sem OCR humano, clientName fica nulo (comportamento anterior preservado)", async () => {
    attFind.mockResolvedValue([{ ...RG_READY, extractedData: { ...RG_READY.extractedData, assignmentPersisted: false } }]);
    await convertProposalToDeal({ proposalId: "p1", orgId: "org1", actorUserId: "x" });
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientName: null }) })
    );
  });
});
