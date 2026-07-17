import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("../status", () => ({
  advanceProposalStatus: vi.fn().mockResolvedValue({ moved: true }),
}));
vi.mock("../notify-proposal", () => ({
  notifyProposalMilestone: vi.fn().mockResolvedValue(undefined),
}));

import { onProposalEnvelopeClosed, onProposalEnvelopeRefused } from "../webhook-hooks";
import { advanceProposalStatus } from "../status";
import { notifyProposalMilestone } from "../notify-proposal";

const envFind = prisma.envelope.findUnique as unknown as ReturnType<typeof vi.fn>;
const propFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const advance = advanceProposalStatus as unknown as ReturnType<typeof vi.fn>;
const notify = notifyProposalMilestone as unknown as ReturnType<typeof vi.fn>;

describe("onProposalEnvelopeClosed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
  });

  it("envelope de contrato → no-op", async () => {
    envFind.mockResolvedValue({ source: "contract", proposalId: null, via: null });
    await onProposalEnvelopeClosed("e1");
    expect(advance).not.toHaveBeenCalled();
  });

  it("via única (sem ocultação) → assinada_proponente e depois completa + sino", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    propFind.mockResolvedValue({ orgId: "org1", userId: "u1", hiddenPaths: [] });
    await onProposalEnvelopeClosed("e1");
    expect(advance).toHaveBeenNthCalledWith(1, "p1", "assinada_proponente");
    expect(advance).toHaveBeenNthCalledWith(2, "p1", "completa", expect.objectContaining({ completedAt: expect.any(Date) }));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", orgId: "org1", userId: "u1", kind: "completed" })
    );
  });

  it("com ocultação, via completa fecha → assinada_proponente → aguardando_vendedor (não completa, sem sino)", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    propFind.mockResolvedValue({ orgId: "org1", userId: "u1", hiddenPaths: ["comissao"] });
    await onProposalEnvelopeClosed("e1");
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toEqual(["assinada_proponente", "aguardando_vendedor"]);
    expect(dests).not.toContain("completa");
    expect(notify).not.toHaveBeenCalled();
  });

  it("via reduzida fecha → completa + sino", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida" });
    propFind.mockResolvedValue({ orgId: "org1", userId: "u1", hiddenPaths: ["comissao"] });
    await onProposalEnvelopeClosed("e1");
    expect(advance).toHaveBeenCalledWith("p1", "completa", expect.objectContaining({ completedAt: expect.any(Date) }));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", kind: "completed" })
    );
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
      expect.objectContaining({ kind: "refused", refusedBy: "vendedor" })
    );
  });

  it("recusa na via completa → recusada_proponente + sino", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa", orgId: "org1" });
    await onProposalEnvelopeRefused("e1");
    expect(advance).toHaveBeenCalledWith("p1", "recusada_proponente", expect.any(Object));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "refused", refusedBy: "proponente" })
    );
  });

  it("envelope de contrato → no-op", async () => {
    envFind.mockResolvedValue({ source: "contract", proposalId: null, via: null });
    await onProposalEnvelopeRefused("e1");
    expect(advance).not.toHaveBeenCalled();
  });

  it("via ÚNICA com hint do proprietário → recusada_vendedor (desfecho quente)", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa", orgId: "org1" });
    await onProposalEnvelopeRefused("e1", { refusedSourceKind: "vendedor" });
    expect(advance).toHaveBeenCalledWith("p1", "recusada_vendedor", expect.any(Object));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "refused", refusedBy: "vendedor", userId: "u1" })
    );
  });

  it("transição rejeitada (replay/ilegal) → SEM sino", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida", orgId: "org1" });
    advance.mockResolvedValue({ moved: false, reason: "illegal", from: "cancelada" });
    await onProposalEnvelopeRefused("e1");
    expect(notify).not.toHaveBeenCalled();
  });
});
