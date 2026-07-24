import { describe, it, expect, vi, beforeEach } from "vitest";
import { runProposalCancel } from "../cancel-execute";
import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus } from "@/lib/proposals/status";
import { runEnvelopeCancel } from "@/lib/clicksign/cancel-action";

vi.mock("@/lib/proposals/status", () => ({
  advanceProposalStatus: vi.fn(),
}));
vi.mock("@/lib/clicksign/cancel-action", () => ({
  runEnvelopeCancel: vi.fn(),
}));

const mockPrisma = vi.mocked(prisma);
const mockAdvance = vi.mocked(advanceProposalStatus);
const mockEnvelopeCancel = vi.mocked(runEnvelopeCancel);

const baseArgs = {
  proposalId: "prop-1",
  orgId: "org-1",
  reason: "cliente desistiu",
  actorUserId: "u1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runProposalCancel", () => {
  it("404 quando proposta não existe ou é de outra org", async () => {
    mockPrisma.proposal.findUnique.mockResolvedValueOnce(null as never);
    const r = await runProposalCancel(baseArgs);
    expect(r.status).toBe(404);

    mockPrisma.proposal.findUnique.mockResolvedValueOnce({
      id: "prop-1",
      orgId: "outra-org",
      status: "enviada",
    } as never);
    const r2 = await runProposalCancel(baseArgs);
    expect(r2.status).toBe(404);
  });

  it("409 quando status não é cancelável", async () => {
    mockPrisma.proposal.findUnique.mockResolvedValueOnce({
      id: "prop-1",
      orgId: "org-1",
      status: "convertida",
    } as never);
    const r = await runProposalCancel(baseArgs);
    expect(r.status).toBe(409);
    expect(mockEnvelopeCancel).not.toHaveBeenCalled();
  });

  it("cancela envelopes ClickSign ANTES de marcar cancelada; aborta 409 se um falhar", async () => {
    mockPrisma.proposal.findUnique.mockResolvedValueOnce({
      id: "prop-1",
      orgId: "org-1",
      status: "enviada",
    } as never);
    mockPrisma.envelope.findMany.mockResolvedValueOnce([
      { id: "env-1" },
      { id: "env-2" },
    ] as never);
    mockEnvelopeCancel
      .mockResolvedValueOnce({ status: 200, body: { ok: true } } as never)
      .mockResolvedValueOnce({
        status: 422,
        body: { error: "já finalizado" },
      } as never);

    const r = await runProposalCancel(baseArgs);

    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain("ClickSign");
    // Status da proposta NÃO foi tocado
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it("caminho feliz: cancela envelopes, avança status, registra evento + audit", async () => {
    mockPrisma.proposal.findUnique.mockResolvedValueOnce({
      id: "prop-1",
      orgId: "org-1",
      status: "enviada",
    } as never);
    mockPrisma.envelope.findMany.mockResolvedValueOnce([{ id: "env-1" }] as never);
    mockEnvelopeCancel.mockResolvedValueOnce({
      status: 200,
      body: { ok: true },
    } as never);
    mockAdvance.mockResolvedValueOnce({ moved: true } as never);
    mockPrisma.proposalEvent.create.mockResolvedValueOnce({} as never);

    const r = await runProposalCancel(baseArgs);

    expect(r).toEqual({ status: 200, body: { ok: true, status: "cancelada" } });
    expect(mockEnvelopeCancel).toHaveBeenCalledWith({
      envelopeId: "env-1",
      reason: "cliente desistiu",
      actorUserId: "u1",
    });
    expect(mockAdvance).toHaveBeenCalledWith(
      "prop-1",
      "cancelada",
      expect.objectContaining({ canceledAt: expect.any(Date) })
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "PROPOSAL_CANCEL" }),
      })
    );
  });
});
