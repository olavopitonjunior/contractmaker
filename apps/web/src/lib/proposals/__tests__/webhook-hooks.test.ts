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

vi.mock("../notify-proposal", () => ({
  notifyProposalMilestone: vi.fn().mockResolvedValue(undefined),
}));

import { onProposalEnvelopeClosed, onProposalEnvelopeRefused } from "../webhook-hooks";
import { advanceProposalStatus } from "../status";
import { sendVendedorEnvelope } from "../send-execute";
import { notifyProposalMilestone } from "../notify-proposal";

const envFind = prisma.envelope.findUnique as unknown as ReturnType<typeof vi.fn>;
const propFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const signerCount = prisma.proposalSigner.count as unknown as ReturnType<typeof vi.fn>;
const envSignerFind = prisma.envelopeSigner.findFirst as unknown as ReturnType<typeof vi.fn>;
const advance = advanceProposalStatus as unknown as ReturnType<typeof vi.fn>;
const sendVend = sendVendedorEnvelope as unknown as ReturnType<typeof vi.fn>;
const notify = notifyProposalMilestone as unknown as ReturnType<typeof vi.fn>;

describe("onProposalEnvelopeClosed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
    sendVend.mockResolvedValue(undefined);
    signerCount.mockResolvedValue(0);
    envSignerFind.mockResolvedValue(null);
    propFind.mockResolvedValue({ orgId: "org1", userId: "u1" });
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
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", orgId: "org1", userId: "u1", kind: "completed" })
    );
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

  it("completa combinada LEGADO (vendedor já no envelope) → completa, SEM 2º envelope", async () => {
    // Migração: envelope único comprador+vendedor em voo no deploy. Ao fechar, o
    // vendedor já assinou aqui → não pode encadear/re-cobrar um 2º envelope.
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    envSignerFind.mockResolvedValue({ id: "es1" }); // vendedor presente no envelope
    signerCount.mockResolvedValue(1); // o plano também tem vendedor — mas não deve importar
    await onProposalEnvelopeClosed("e1");
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toEqual(["assinada_proponente", "completa"]);
    expect(dests).not.toContain("aguardando_vendedor");
    expect(sendVend).not.toHaveBeenCalled();
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
    propFind.mockResolvedValue({ userId: "u1" });
  });

  it("recusa na via reduzida → recusada_vendedor (o desfecho quente) + sino", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida", orgId: "org1" });
    await onProposalEnvelopeRefused("e1");
    expect(advance).toHaveBeenCalledWith("p1", "recusada_vendedor", expect.any(Object));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "refused", refusedBy: "vendedor", userId: "u1" })
    );
  });

  it("via ÚNICA com hint do proprietário → recusada_vendedor", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa", orgId: "org1" });
    await onProposalEnvelopeRefused("e1", { refusedSourceKind: "vendedor" });
    expect(advance).toHaveBeenCalledWith("p1", "recusada_vendedor", expect.any(Object));
  });

  it("transição rejeitada (replay/ilegal) → SEM sino", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida", orgId: "org1" });
    advance.mockResolvedValue({ moved: false, reason: "illegal", from: "cancelada" });
    await onProposalEnvelopeRefused("e1");
    expect(notify).not.toHaveBeenCalled();
  });

  it("recusa na via completa → recusada_proponente", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa", orgId: "org1" });
    await onProposalEnvelopeRefused("e1");
    expect(advance).toHaveBeenCalledWith("p1", "recusada_proponente", expect.any(Object));
  });

  it("envelope de contrato → no-op", async () => {
    envFind.mockResolvedValue({ source: "contract", proposalId: null, via: null });
    await onProposalEnvelopeRefused("e1");
    expect(advance).not.toHaveBeenCalled();
  });
});
