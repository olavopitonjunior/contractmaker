import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("../status", () => ({
  advanceProposalStatus: vi.fn().mockResolvedValue({ moved: true }),
}));

import { onProposalEnvelopeClosed, onProposalEnvelopeRefused } from "../webhook-hooks";
import { advanceProposalStatus } from "../status";

const envFind = prisma.envelope.findUnique as unknown as ReturnType<typeof vi.fn>;
const propFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const advance = advanceProposalStatus as unknown as ReturnType<typeof vi.fn>;

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

  it("via única (sem ocultação) → assinada_proponente e depois completa", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    propFind.mockResolvedValue({ hiddenPaths: [] });
    await onProposalEnvelopeClosed("e1");
    expect(advance).toHaveBeenNthCalledWith(1, "p1", "assinada_proponente");
    expect(advance).toHaveBeenNthCalledWith(2, "p1", "completa", expect.objectContaining({ completedAt: expect.any(Date) }));
  });

  it("com ocultação, via completa fecha → assinada_proponente → aguardando_vendedor (não completa)", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    propFind.mockResolvedValue({ hiddenPaths: ["comissao"] });
    await onProposalEnvelopeClosed("e1");
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toEqual(["assinada_proponente", "aguardando_vendedor"]);
    expect(dests).not.toContain("completa");
  });

  it("via reduzida fecha → completa", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida" });
    propFind.mockResolvedValue({ hiddenPaths: ["comissao"] });
    await onProposalEnvelopeClosed("e1");
    expect(advance).toHaveBeenCalledWith("p1", "completa", expect.objectContaining({ completedAt: expect.any(Date) }));
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
