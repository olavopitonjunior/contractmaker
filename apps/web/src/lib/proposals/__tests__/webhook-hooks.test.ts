import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => p,
}));

vi.mock("../status", () => ({
  advanceProposalStatus: vi.fn().mockResolvedValue({ moved: true }),
}));

vi.mock("../send-execute", () => ({
  sendVendedorEnvelope: vi.fn().mockResolvedValue(undefined),
}));

import { onProposalEnvelopeClosed, onProposalEnvelopeRefused } from "../webhook-hooks";
import { advanceProposalStatus } from "../status";
import { sendVendedorEnvelope } from "../send-execute";

const envFind = prisma.envelope.findUnique as unknown as ReturnType<typeof vi.fn>;
const signerCount = prisma.proposalSigner.count as unknown as ReturnType<typeof vi.fn>;
const advance = advanceProposalStatus as unknown as ReturnType<typeof vi.fn>;
const sendVend = sendVendedorEnvelope as unknown as ReturnType<typeof vi.fn>;

describe("onProposalEnvelopeClosed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
    sendVend.mockResolvedValue(undefined);
    signerCount.mockResolvedValue(0);
  });

  it("envelope de contrato → no-op", async () => {
    envFind.mockResolvedValue({ source: "contract", proposalId: null, via: null });
    await onProposalEnvelopeClosed("e1");
    expect(advance).not.toHaveBeenCalled();
    expect(sendVend).not.toHaveBeenCalled();
  });

  it("completa fecha SEM vendedor → assinada_proponente e depois completa", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    signerCount.mockResolvedValue(0);
    await onProposalEnvelopeClosed("e1");
    expect(advance).toHaveBeenNthCalledWith(1, "p1", "assinada_proponente");
    expect(advance).toHaveBeenNthCalledWith(2, "p1", "completa", expect.objectContaining({ completedAt: expect.any(Date) }));
    expect(sendVend).not.toHaveBeenCalled();
  });

  it("completa fecha COM vendedor → assinada_proponente → aguardando_vendedor + dispara 2º envelope", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    signerCount.mockResolvedValue(1);
    await onProposalEnvelopeClosed("e1");
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toEqual(["assinada_proponente", "aguardando_vendedor"]);
    expect(dests).not.toContain("completa");
    expect(sendVend).toHaveBeenCalledWith("p1");
  });

  it("via reduzida (proprietário) fecha → completa", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida" });
    await onProposalEnvelopeClosed("e1");
    expect(advance).toHaveBeenCalledWith("p1", "completa", expect.objectContaining({ completedAt: expect.any(Date) }));
    expect(sendVend).not.toHaveBeenCalled();
  });
});

describe("onProposalEnvelopeRefused", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
  });

  it("recusa na via reduzida → recusada_vendedor (o desfecho quente)", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida" });
    await onProposalEnvelopeRefused("e1");
    expect(advance).toHaveBeenCalledWith("p1", "recusada_vendedor", expect.any(Object));
  });

  it("recusa na via completa → recusada_proponente", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    await onProposalEnvelopeRefused("e1");
    expect(advance).toHaveBeenCalledWith("p1", "recusada_proponente", expect.any(Object));
  });

  it("envelope de contrato → no-op", async () => {
    envFind.mockResolvedValue({ source: "contract", proposalId: null, via: null });
    await onProposalEnvelopeRefused("e1");
    expect(advance).not.toHaveBeenCalled();
  });
});
