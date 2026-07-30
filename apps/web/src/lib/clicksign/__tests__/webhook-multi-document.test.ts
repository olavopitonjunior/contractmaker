import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/clicksign/signed-pdf", () => ({
  persistSignedPdf: vi.fn().mockResolvedValue(undefined),
  persistSignedDocumentByKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/clicksign/envelopes", () => ({
  listEnvelopeDocuments: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock("@/lib/clicksign/account", () => ({
  resolveClickSignCreds: vi
    .fn()
    .mockResolvedValue({ apiToken: "t", baseUrl: "https://x" }),
}));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/contracts/auto-promote-signed", () => ({
  autoPromoteDealOnContractSigned: vi.fn().mockResolvedValue({ promoted: false }),
}));
vi.mock("@/lib/clicksign/notify-envelope", () => ({
  notifyEnvelopeMilestone: vi.fn().mockResolvedValue(undefined),
  resolveDealLink: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/notifications/deal-events", () => ({
  notifyDealEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/locacao/inspection-signature", () => ({
  completeInspectionOnEnvelopeClosed: vi
    .fn()
    .mockResolvedValue({ completed: false }),
  revertInspectionOnEnvelopeCanceled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/proposals/webhook-hooks", () => ({
  onProposalEnvelopeClosed: vi.fn().mockResolvedValue(undefined),
  onProposalEnvelopeRefused: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/proposals/acceptance-webhook", () => ({
  processProposalAcceptanceEvent: vi.fn(),
}));
// waitUntil é fire-and-forget em produção; no teste guardamos as promises pra
// poder esperar o download do PDF antes de asserir.
const { pendingWork } = vi.hoisted(() => ({ pendingWork: [] as Promise<unknown>[] }));
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((p: Promise<unknown>) => {
    pendingWork.push(p);
    return p;
  }),
}));

/** Drena o fire-and-forget disparado pelo webhook. */
async function flushWaitUntil() {
  await Promise.all(pendingWork.splice(0));
}

import { processClickSignWebhookPayload } from "../webhook-process";
import {
  persistSignedPdf,
  persistSignedDocumentByKey,
} from "@/lib/clicksign/signed-pdf";
import { listEnvelopeDocuments } from "@/lib/clicksign/envelopes";
import { autoPromoteDealOnContractSigned } from "@/lib/contracts/auto-promote-signed";
import { completeInspectionOnEnvelopeClosed } from "@/lib/locacao/inspection-signature";
import { notifyEnvelopeMilestone } from "@/lib/clicksign/notify-envelope";
import { notifyDealEvent } from "@/lib/notifications/deal-events";
import type { WebhookPayload } from "@/lib/clicksign/types";

type MockFn = ReturnType<typeof vi.fn>;
const persistMock = persistSignedPdf as unknown as MockFn;
const persistOneMock = persistSignedDocumentByKey as unknown as MockFn;
const listDocsMock = listEnvelopeDocuments as unknown as MockFn;
const promoteMock = autoPromoteDealOnContractSigned as unknown as MockFn;
const inspectionMock = completeInspectionOnEnvelopeClosed as unknown as MockFn;
const milestoneMock = notifyEnvelopeMilestone as unknown as MockFn;
const dealEventMock = notifyDealEvent as unknown as MockFn;
const envelopeDb = prisma.envelope as unknown as Record<string, MockFn>;
const eventDb = prisma.envelopeEvent as unknown as Record<string, MockFn>;
const envelopeDocDb = prisma.envelopeDocument as unknown as Record<string, MockFn>;

const ENVELOPE = {
  id: "env-1",
  orgId: "org-1",
  dealId: "deal-1",
  clicksignId: "cs-env",
  documentClicksignId: "cs-doc-1",
  source: "contract",
  status: "running",
  signedDocumentUrl: null,
};

function closePayload(documentKey: string): WebhookPayload {
  return {
    event: { name: "close", occurred_at: "2026-07-30T12:00:00Z", data: {} },
    document: { key: documentKey },
  } as unknown as WebhookPayload;
}

function documentClosedPayload(documentKey: string): WebhookPayload {
  return {
    event: {
      name: "document_closed",
      occurred_at: "2026-07-30T12:00:00Z",
      data: {},
    },
    document: { key: documentKey },
  } as unknown as WebhookPayload;
}

/** Envelope unificado: contrato (primary) + laudo de vistoria (attachment). */
const UNIFIED_DOCS = [
  { documentClicksignId: "cs-doc-1", kind: "primary" },
  { documentClicksignId: "cs-doc-2", kind: "attachment" },
];

beforeEach(() => {
  vi.clearAllMocks();
  envelopeDb.findFirst = vi.fn().mockResolvedValue(ENVELOPE);
  envelopeDb.update = vi.fn().mockResolvedValue({});
  eventDb.create = vi.fn().mockResolvedValue({});
  envelopeDocDb.findMany = vi.fn().mockResolvedValue([]);
  listDocsMock.mockResolvedValue({ data: [] });
  pendingWork.splice(0);
});

describe("webhook — envelope com vários documentos", () => {
  it("resolve o envelope pelo document.key de um documento EXTRA", async () => {
    const res = await processClickSignWebhookPayload(closePayload("cs-doc-2"));

    expect(res.unknownEnvelope).toBeUndefined();
    expect(res.envelopeId).toBe("env-1");
    // O lookup considera a coluna escalar (primary) E as rows de EnvelopeDocument.
    const where = envelopeDb.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { documentClicksignId: "cs-doc-2" },
      { documents: { some: { documentClicksignId: "cs-doc-2" } } },
    ]);
  });

  it("evento de documento EXTRA não grava a URL do payload como assinado do envelope", async () => {
    const payload = closePayload("cs-doc-2");
    (payload as unknown as Record<string, unknown>).document = {
      key: "cs-doc-2",
      downloads: { signed_file_url: "https://cs/laudo.pdf" },
    };

    await processClickSignWebhookPayload(payload);
    await flushWaitUntil();

    // Cai no lookup via /documents (que prioriza o primary), nunca na URL do
    // evento — senão o laudo viraria o "contrato assinado" do envelope.
    expect(persistMock).not.toHaveBeenCalledWith(
      "env-1",
      "https://cs/laudo.pdf",
      expect.anything()
    );
    expect(listDocsMock).toHaveBeenCalledWith("cs-env", expect.anything());
  });

  it("evento do documento PRIMARY segue usando a URL do payload (caminho antigo)", async () => {
    const payload = closePayload("cs-doc-1");
    (payload as unknown as Record<string, unknown>).document = {
      key: "cs-doc-1",
      downloads: { signed_file_url: "https://cs/contrato.pdf" },
    };

    await processClickSignWebhookPayload(payload);
    await flushWaitUntil();

    expect(persistMock).toHaveBeenCalledWith(
      "env-1",
      "https://cs/contrato.pdf",
      expect.anything()
    );
    expect(listDocsMock).not.toHaveBeenCalled();
  });

  it("resolveAndDownload prioriza o documento primary na lista remota", async () => {
    listDocsMock.mockResolvedValue({
      data: [
        { id: "cs-doc-2", links: { files: { signed: "https://cs/laudo.pdf" } } },
        { id: "cs-doc-1", links: { files: { signed: "https://cs/contrato.pdf" } } },
      ],
    });

    await processClickSignWebhookPayload(closePayload("cs-doc-2"));
    await flushWaitUntil();

    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledWith(
      "env-1",
      "https://cs/contrato.pdf",
      expect.anything()
    );
  });
});

/**
 * `document_closed` é POR DOCUMENTO na v3. Num envelope unificado (contrato +
 * laudo) o laudo fecha ANTES do contrato; tratar isso como fechamento do
 * envelope promovia o deal, concluía a Inspection e avisava as partes que "o
 * contrato foi assinado" antes de existir contrato assinado.
 */
describe("webhook — document_closed é por DOCUMENTO", () => {
  /** Nenhum efeito de fechamento do ENVELOPE disparou. */
  function expectNoEnvelopeClose() {
    expect(envelopeDb.update).not.toHaveBeenCalled();
    expect(promoteMock).not.toHaveBeenCalled();
    expect(inspectionMock).not.toHaveBeenCalled();
    expect(milestoneMock).not.toHaveBeenCalled();
    expect(dealEventMock).not.toHaveBeenCalled();
  }

  it("(a) doc EXTRA fecha: persiste só o assinado dele e não toca no envelope", async () => {
    envelopeDocDb.findMany.mockResolvedValue(UNIFIED_DOCS);

    const res = await processClickSignWebhookPayload(
      documentClosedPayload("cs-doc-2")
    );
    await flushWaitUntil();

    expect(res.envelopeId).toBe("env-1");
    // O EnvelopeEvent é registrado (rastro do evento), mas nada mais muda.
    expect(eventDb.create).toHaveBeenCalledTimes(1);
    expect(persistOneMock).toHaveBeenCalledWith(
      "env-1",
      "cs-doc-2",
      expect.anything()
    );
    expect(persistMock).not.toHaveBeenCalled();
    expectNoEnvelopeClose();
  });

  it("(b) doc PRIMARY fecha e o envelope NÃO tem extras: comportamento antigo intacto", async () => {
    envelopeDocDb.findMany.mockResolvedValue([
      { documentClicksignId: "cs-doc-1", kind: "primary" },
    ]);

    await processClickSignWebhookPayload(documentClosedPayload("cs-doc-1"));
    await flushWaitUntil();

    expect(envelopeDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "env-1" },
        data: expect.objectContaining({ status: "closed" }),
      })
    );
    expect(promoteMock).toHaveBeenCalledWith("env-1");
    expect(inspectionMock).toHaveBeenCalledWith("env-1");
    expect(milestoneMock).toHaveBeenCalled();
    expect(persistOneMock).not.toHaveBeenCalled();
  });

  it("(b') envelope legado SEM rows de EnvelopeDocument também fecha (compat)", async () => {
    envelopeDocDb.findMany.mockResolvedValue([]);

    await processClickSignWebhookPayload(documentClosedPayload("cs-doc-1"));

    expect(envelopeDb.update).toHaveBeenCalled();
    expect(promoteMock).toHaveBeenCalledWith("env-1");
  });

  it("(c) doc PRIMARY fecha COM extras: baixa o assinado mas NÃO fecha o envelope", async () => {
    envelopeDocDb.findMany.mockResolvedValue(UNIFIED_DOCS);
    listDocsMock.mockResolvedValue({
      data: [
        { id: "cs-doc-1", links: { files: { signed: "https://cs/contrato.pdf" } } },
      ],
    });

    await processClickSignWebhookPayload(documentClosedPayload("cs-doc-1"));
    await flushWaitUntil();

    expect(persistMock).toHaveBeenCalledWith(
      "env-1",
      "https://cs/contrato.pdf",
      expect.anything()
    );
    expectNoEnvelopeClose();
  });

  it("close/auto_close seguem fechando mesmo com extras", async () => {
    envelopeDocDb.findMany.mockResolvedValue(UNIFIED_DOCS);

    await processClickSignWebhookPayload(closePayload("cs-doc-1"));

    expect(envelopeDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "closed" }),
      })
    );
    expect(promoteMock).toHaveBeenCalledWith("env-1");
  });

  it("reentrega do document_closed do laudo é idempotente e não fecha o envelope", async () => {
    envelopeDocDb.findMany.mockResolvedValue(UNIFIED_DOCS);
    eventDb.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );

    const res = await processClickSignWebhookPayload(
      documentClosedPayload("cs-doc-2")
    );
    await flushWaitUntil();

    expect(res.duplicate).toBe(true);
    // Só o assinado DAQUELE documento é recuperado (o helper pula quem já tem
    // signedPdfUrl) — nunca a URL do primary, que marcaria o contrato como
    // assinado antes da hora.
    expect(persistOneMock).toHaveBeenCalledWith(
      "env-1",
      "cs-doc-2",
      expect.anything()
    );
    expect(persistMock).not.toHaveBeenCalled();
    expectNoEnvelopeClose();
  });
});
