import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => p,
}));

vi.mock("../status", () => ({
  advanceProposalStatus: vi.fn().mockResolvedValue({ moved: true }),
}));

vi.mock("../acceptance-proof", () => ({
  buildAcceptanceProof: vi.fn().mockResolvedValue({ url: "https://x/comprovante.pdf" }),
  buildAcceptanceMessage: vi.fn().mockReturnValue("Declaro que li..."),
}));

import { processProposalAcceptanceEvent } from "../acceptance-webhook";
import { advanceProposalStatus } from "../status";
import { buildAcceptanceProof } from "../acceptance-proof";

const propFind = prisma.proposal.findFirst as unknown as ReturnType<typeof vi.fn>;
const advance = advanceProposalStatus as unknown as ReturnType<typeof vi.fn>;
const proof = buildAcceptanceProof as unknown as ReturnType<typeof vi.fn>;

const PROPOSAL = { id: "p1", title: "Proposta X", token: "tok", instrument: "aceite" };

describe("processProposalAcceptanceEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
    proof.mockResolvedValue({ url: "https://x/comprovante.pdf" });
  });

  it("acceptance_term id desconhecido → unknownAcceptance, sem mutação", async () => {
    propFind.mockResolvedValue(null);
    const r = await processProposalAcceptanceEvent({
      acceptanceId: "acc_x",
      phase: "completed",
      payload: {},
    });
    expect(r.unknownAcceptance).toBe(true);
    expect(advance).not.toHaveBeenCalled();
  });

  it("sent → entregue (deliveredAt)", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "sent", payload: {} });
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "entregue",
      expect.objectContaining({ deliveredAt: expect.any(Date) })
    );
  });

  it("completed → assinada_proponente → completa + comprovante", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({
      acceptanceId: "acc_1",
      phase: "completed",
      payload: { event: { data: { acceptance_term: { signer_name: "Ana", signer_phone: "5541999" } } } },
    });
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toEqual(["assinada_proponente", "completa"]);
    expect(proof).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ signerName: "Ana", acceptanceId: "acc_1" })
    );
  });

  it("refused → recusada_proponente", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "refused", payload: {} });
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "recusada_proponente",
      expect.objectContaining({ refusedAt: expect.any(Date) })
    );
    expect(proof).not.toHaveBeenCalled();
  });

  it("expired → expirada (terminal)", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "expired", payload: {} });
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "expirada",
      expect.objectContaining({ expiredAt: expect.any(Date) })
    );
  });

  it("fase desconhecida (created) → só registra, sem mutação de status", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    const r = await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "created", payload: {} });
    expect(r.handled).toBe(false);
    expect(advance).not.toHaveBeenCalled();
  });
});
