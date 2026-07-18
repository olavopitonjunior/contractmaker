import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

// ClickSign REST layer — respostas mínimas; cada teste sobrescreve o status.
vi.mock("../envelopes", () => ({
  getEnvelope: vi.fn(),
  listEnvelopeSigners: vi.fn().mockResolvedValue({ data: [] }),
  listEnvelopeRequirements: vi.fn().mockResolvedValue({ data: [] }),
  listEnvelopeEvents: vi.fn().mockResolvedValue({ data: [] }),
  listEnvelopeDocuments: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock("../account", () => ({
  resolveClickSignCreds: vi.fn().mockResolvedValue({ apiToken: "t", baseUrl: "https://x" }),
}));
vi.mock("@/lib/clicksign/signed-pdf", () => ({
  persistSignedPdf: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/contracts/auto-promote-signed", () => ({
  autoPromoteDealOnContractSigned: vi.fn().mockResolvedValue({ promoted: false }),
}));
vi.mock("@/lib/clicksign/notify-envelope", () => ({
  notifyEnvelopeMilestone: vi.fn().mockResolvedValue(undefined),
  resolveDealLink: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/locacao/inspection-signature", () => ({
  completeInspectionOnEnvelopeClosed: vi.fn().mockResolvedValue(undefined),
  revertInspectionOnEnvelopeCanceled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/proposals/webhook-hooks", () => ({
  onProposalEnvelopeClosed: vi.fn().mockResolvedValue(undefined),
  onProposalEnvelopeRefused: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { syncEnvelopeState } from "../sync";
import { getEnvelope, listEnvelopeEvents } from "../envelopes";
import {
  onProposalEnvelopeClosed,
  onProposalEnvelopeRefused,
} from "@/lib/proposals/webhook-hooks";

const getEnv = getEnvelope as unknown as ReturnType<typeof vi.fn>;
const listEvents = listEnvelopeEvents as unknown as ReturnType<typeof vi.fn>;
const onClosed = onProposalEnvelopeClosed as unknown as ReturnType<typeof vi.fn>;
const onRefused = onProposalEnvelopeRefused as unknown as ReturnType<typeof vi.fn>;

function makeEnvelope(over: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    clicksignId: "cs-1",
    orgId: "org-1",
    source: "proposal",
    proposalId: "prop-1",
    dealId: null,
    via: "completa",
    status: "running",
    signedDocumentUrl: null,
    signers: [],
    ...over,
  } as never;
}

function remote(status: string) {
  return { data: { attributes: { status } } };
}

describe("syncEnvelopeState — propagação pra proposta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // envelopeEvent não está no mock global do prisma — o reconciler grava o
    // audit `manual_sync`; stubamos aqui.
    (prisma as unknown as { envelopeEvent: { create: ReturnType<typeof vi.fn> } }).envelopeEvent = {
      create: vi.fn().mockResolvedValue({}),
    };
    (prisma.envelope.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    listEvents.mockResolvedValue({ data: [] });
  });

  it("proposta fechada (close reconciliado) → chama onProposalEnvelopeClosed", async () => {
    getEnv.mockResolvedValue(remote("closed"));
    await syncEnvelopeState(makeEnvelope(), { actorVia: "cron" });
    expect(onClosed).toHaveBeenCalledWith("env-1");
    expect(onRefused).not.toHaveBeenCalled();
  });

  it("proposta cancelada → chama onProposalEnvelopeRefused", async () => {
    getEnv.mockResolvedValue(remote("canceled"));
    await syncEnvelopeState(makeEnvelope(), { actorVia: "cron" });
    expect(onRefused).toHaveBeenCalledWith("env-1", { refusedSourceKind: null });
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("recusa recém-descoberta na via única → propaga o sourceKind do recusante", async () => {
    getEnv.mockResolvedValue(remote("running"));
    listEvents.mockResolvedValue({
      data: [
        {
          attributes: {
            name: "refusal",
            created: "2026-07-17T12:00:00Z",
            data: { signer: { key: "sk-vendedor" } },
          },
        },
      ],
    });
    const env = makeEnvelope({
      signers: [
        {
          id: "sg-1",
          clicksignId: "sk-vendedor",
          email: null,
          status: "sent",
          sourceKind: "vendedor",
          refusedAt: null,
          signedAt: null,
          viewedAt: null,
        },
      ],
    });
    await syncEnvelopeState(env, { actorVia: "cron" });
    expect(onRefused).toHaveBeenCalledWith("env-1", { refusedSourceKind: "vendedor" });
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("envelope de contrato fechado → NÃO toca nos hooks de proposta", async () => {
    getEnv.mockResolvedValue(remote("closed"));
    await syncEnvelopeState(
      makeEnvelope({ source: "contract", proposalId: null, dealId: "deal-1" }),
      { actorVia: "cron" }
    );
    expect(onClosed).not.toHaveBeenCalled();
    expect(onRefused).not.toHaveBeenCalled();
  });
});
