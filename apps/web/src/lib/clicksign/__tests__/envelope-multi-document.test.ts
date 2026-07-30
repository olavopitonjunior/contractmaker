import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

// REST ClickSign mockado — o teste valida a ORQUESTRAÇÃO do envelope com N
// documentos (contrato + laudo de vistoria): 1 addDocument por documento,
// requirements de CADA signatário em CADA documento, rows de EnvelopeDocument.
vi.mock("../envelopes", () => ({
  activateEnvelope: vi.fn().mockResolvedValue({}),
  addDocument: vi.fn(),
  addRequirement: vi.fn(),
  addSigner: vi.fn(),
  cancelEnvelope: vi.fn(),
  createEnvelope: vi.fn(),
  deleteDraftEnvelope: vi.fn().mockResolvedValue(undefined),
  getEnvelope: vi.fn(),
  listEnvelopeSigners: vi.fn(),
}));
vi.mock("../account", () => {
  class AuthMethodNotAllowedError extends Error {}
  return {
    AuthMethodNotAllowedError,
    getSignatureSettings: vi.fn().mockResolvedValue({
      defaultAuthMethod: "email",
      allowedAuthMethods: [],
      defaultDeadlineDays: 0,
      defaultSequential: false,
      defaultLocale: "pt-BR",
      autoClose: true,
      refusable: true,
      monthlyBudgetCents: 100_000,
      costOverridesJson: null,
    }),
    requireClickSignCreds: vi
      .fn()
      .mockResolvedValue({ apiToken: "t", baseUrl: "https://x" }),
    resolveClickSignCreds: vi
      .fn()
      .mockResolvedValue({ apiToken: "t", baseUrl: "https://x" }),
  };
});
vi.mock("@/lib/security/budget-lock", () => ({
  withOrgBudgetLock: vi.fn(async (_ns: string, _org: string, fn: never) =>
    (fn as unknown as (tx: unknown) => unknown)(prisma)
  ),
}));
vi.mock("@/lib/storage/s3", () => ({
  uploadBufferToStorage: vi.fn().mockResolvedValue("s3://snapshot.pdf"),
  downloadBufferFromUrl: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/lib/render/contract-pdf", () => ({
  generateContractPdfBuffer: vi
    .fn()
    .mockResolvedValue({ buffer: Buffer.from("contrato"), filename: "Contrato.pdf" }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/notifications/deal-events", () => ({
  notifyDealEvent: vi.fn().mockResolvedValue(undefined),
}));

import { sendEnvelopeForContract } from "../executor";
import {
  addDocument,
  addRequirement,
  addSigner,
  createEnvelope,
} from "../envelopes";

type MockFn = ReturnType<typeof vi.fn>;
const addDocumentMock = addDocument as unknown as MockFn;
const addRequirementMock = addRequirement as unknown as MockFn;
const addSignerMock = addSigner as unknown as MockFn;
const createEnvelopeMock = createEnvelope as unknown as MockFn;

const contractDb = prisma.contract as unknown as Record<string, MockFn>;
const envelopeDb = prisma.envelope as unknown as Record<string, MockFn>;
const envelopeDocDb = prisma.envelopeDocument as unknown as Record<string, MockFn>;
const envelopeSignerDb = prisma.envelopeSigner as unknown as Record<string, MockFn>;

const SIGNERS = [
  { name: "Locador", email: "locador@example.com", sourceKind: "locador", sourceIndex: 0 },
  { name: "Locatário", email: "locatario@example.com", sourceKind: "locatario", sourceIndex: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  contractDb.findUnique = vi.fn().mockResolvedValue({
    id: "ctr-1",
    dealId: "deal-1",
    status: "aprovado",
    version: 1,
    dataJson: {},
    deal: { pipeline: { orgId: "org-1", kind: "locacao" } },
  });
  envelopeDb.findFirst = vi.fn().mockResolvedValue(null);
  envelopeDb.aggregate = vi.fn().mockResolvedValue({ _sum: { costCents: 0 } });
  envelopeDb.create = vi.fn().mockResolvedValue({
    id: "env-1",
    name: "Contrato",
    deadlineAt: null,
    signers: [
      { id: "loc-1", name: "Locador", email: "locador@example.com", role: "seller", sourceKind: "locador", documentation: null, phone: null, signingGroup: null, notifyChannel: "email" },
      { id: "loc-2", name: "Locatário", email: "locatario@example.com", role: "buyer", sourceKind: "locatario", documentation: null, phone: null, signingGroup: null, notifyChannel: "email" },
    ],
  });
  envelopeDb.update = vi.fn().mockResolvedValue({ id: "env-1", status: "running" });
  envelopeDocDb.createMany = vi.fn().mockResolvedValue({ count: 0 });
  envelopeSignerDb.findMany = vi.fn().mockResolvedValue([]);
  envelopeSignerDb.update = vi.fn().mockResolvedValue({});
  envelopeSignerDb.updateMany = vi.fn().mockResolvedValue({ count: 0 });

  createEnvelopeMock.mockResolvedValue({ data: { id: "cs-env" } });
  let docSeq = 0;
  addDocumentMock.mockImplementation(async () => ({
    data: { id: `cs-doc-${++docSeq}` },
  }));
  let signerSeq = 0;
  addSignerMock.mockImplementation(async () => ({
    data: { id: `cs-sig-${++signerSeq}` },
  }));
  let reqSeq = 0;
  addRequirementMock.mockImplementation(async () => ({
    data: { id: `cs-req-${++reqSeq}` },
  }));
});

describe("createEnvelopeFromBuffer com extraDocuments", () => {
  it("sobe 1 documento por PDF e aplica requirements de cada signer em CADA doc", async () => {
    await sendEnvelopeForContract({
      contractId: "ctr-1",
      signers: SIGNERS,
      extraDocuments: [
        {
          buffer: Buffer.from("laudo"),
          filename: "Laudo de vistoria (entrada).pdf",
          sourceAttachmentId: "att-laudo",
        },
      ],
    });

    expect(addDocumentMock).toHaveBeenCalledTimes(2);
    expect(addDocumentMock.mock.calls[0][0]).toMatchObject({
      envelopeId: "cs-env",
      filename: "Contrato.pdf",
    });
    expect(addDocumentMock.mock.calls[1][0]).toMatchObject({
      filename: "Laudo de vistoria (entrada).pdf",
    });

    // 2 signatários × 2 documentos × (auth + agree) = 8 requirements.
    expect(addRequirementMock).toHaveBeenCalledTimes(8);
    const byDoc = new Map<string, string[]>();
    for (const [arg] of addRequirementMock.mock.calls) {
      const key = `${arg.signerClicksignId}|${arg.documentClicksignId}`;
      byDoc.set(key, [...(byDoc.get(key) ?? []), arg.action]);
    }
    for (const signerId of ["cs-sig-1", "cs-sig-2"]) {
      for (const docId of ["cs-doc-1", "cs-doc-2"]) {
        expect(byDoc.get(`${signerId}|${docId}`)).toEqual([
          "provide_evidence",
          "agree",
        ]);
      }
    }
  });

  it("persiste EnvelopeDocument: primary + attachment com sourceAttachmentId", async () => {
    await sendEnvelopeForContract({
      contractId: "ctr-1",
      signers: SIGNERS,
      extraDocuments: [
        {
          buffer: Buffer.from("laudo"),
          filename: "Laudo de vistoria (entrada).pdf",
          sourceAttachmentId: "att-laudo",
        },
      ],
    });

    expect(envelopeDocDb.createMany).toHaveBeenCalledTimes(1);
    const arg = envelopeDocDb.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual([
      {
        envelopeId: "env-1",
        documentClicksignId: "cs-doc-1",
        kind: "primary",
        filename: "Contrato.pdf",
        sourceAttachmentId: null,
        position: 0,
      },
      {
        envelopeId: "env-1",
        documentClicksignId: "cs-doc-2",
        kind: "attachment",
        filename: "Laudo de vistoria (entrada).pdf",
        sourceAttachmentId: "att-laudo",
        position: 1,
      },
    ]);
  });

  it("custo NÃO muda com documento extra — a ClickSign cobra por signatário", async () => {
    await sendEnvelopeForContract({
      contractId: "ctr-1",
      signers: SIGNERS,
      extraDocuments: [
        { buffer: Buffer.from("laudo"), filename: "Laudo.pdf" },
      ],
    });
    // 2 signatários × R$1,50 (email) — o 2º documento não entra na conta.
    expect(envelopeDb.create.mock.calls[0][0].data.costCents).toBe(300);
  });

  it("sem extraDocuments: 1 documento e 2 requirements por signatário (comportamento antigo)", async () => {
    await sendEnvelopeForContract({ contractId: "ctr-1", signers: SIGNERS });

    expect(addDocumentMock).toHaveBeenCalledTimes(1);
    expect(addRequirementMock).toHaveBeenCalledTimes(4);
    for (const [arg] of addRequirementMock.mock.calls) {
      expect(arg.documentClicksignId).toBe("cs-doc-1");
    }
    const arg = envelopeDocDb.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0]).toMatchObject({ kind: "primary", position: 0 });
    // Coluna escalar continua sendo a fonte de verdade do doc primary.
    expect(envelopeDb.update.mock.calls[0][0].data.documentClicksignId).toBe(
      "cs-doc-1"
    );
  });

  it("falha ao subir o documento extra aborta o envio e marca o envelope failed", async () => {
    addDocumentMock
      .mockResolvedValueOnce({ data: { id: "cs-doc-1" } })
      .mockResolvedValueOnce({ data: {} }); // sem id

    await expect(
      sendEnvelopeForContract({
        contractId: "ctr-1",
        signers: SIGNERS,
        extraDocuments: [{ buffer: Buffer.from("x"), filename: "Laudo.pdf" }],
      })
    ).rejects.toThrow(/documento extra/i);

    expect(addSignerMock).not.toHaveBeenCalled();
    const failed = envelopeDb.update.mock.calls.find(
      (c) => c[0]?.data?.status === "failed"
    );
    expect(failed).toBeTruthy();
  });
});
