import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
  proposalFeatureGuard: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/clicksign/executor", () => ({
  cancelEnvelopeFlow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/clicksign/envelopes", () => ({
  updateEnvelope: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/proposals/webhook-hooks", () => ({
  onProposalEnvelopeCanceled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

import { DELETE } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { cancelEnvelopeFlow } from "@/lib/clicksign/executor";
import { onProposalEnvelopeCanceled } from "@/lib/proposals/webhook-hooks";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockCancelFlow = vi.mocked(cancelEnvelopeFlow);
const mockPropagate = vi.mocked(onProposalEnvelopeCanceled);
const mockPrisma = vi.mocked(prisma);

function req() {
  return new NextRequest("http://localhost/api/proposals/p1/envelopes/e1", {
    method: "DELETE",
  });
}

const params = { params: { id: "p1", envelopeId: "e1" } };

/** Escopo resolvido com PROPOSAL_CANCEL — `can()` só lê `permissions`. */
function scoped() {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: { permissions: { [PERMISSION.PROPOSAL_CANCEL]: true } },
    proposal: { id: "p1", orgId: "org-1", status: "enviada", kind: "venda" },
  } as never);
}

function envelope(status: string) {
  mockPrisma.envelope.findFirst.mockResolvedValue({
    id: "e1",
    orgId: "org-1",
    proposalId: "p1",
    via: "completa",
    status,
    signers: [],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  scoped();
  mockPrisma.proposalEvent.create.mockResolvedValue({} as never);
  mockCancelFlow.mockResolvedValue(undefined);
  mockPropagate.mockResolvedValue(undefined);
});

describe("DELETE /api/proposals/[id]/envelopes/[envelopeId]", () => {
  it("cancela e propaga pro status da proposta com cause app", async () => {
    envelope("running");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect(mockCancelFlow).toHaveBeenCalledWith("e1");
    expect(mockPropagate).toHaveBeenCalledWith("e1", "app");
  });

  it("envelope JÁ cancelado ainda propaga — senão o botão é no-op permanente", async () => {
    // O cenário real: o cancelamento veio de fora (webhook/reconcile), que
    // propaga SEM a flag e portanto não libera a 1ª via. A proposta está presa
    // e o corretor clica "Cancelar" justamente pra destravá-la. Se o retorno
    // idempotente saísse antes da propagação, o clique nunca teria efeito.
    envelope("canceled");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadyCanceled: true });
    // Não recancela na ClickSign...
    expect(mockCancelFlow).not.toHaveBeenCalled();
    // ...mas destrava a proposta.
    expect(mockPropagate).toHaveBeenCalledWith("e1", "app");
  });

  it("falha na propagação não derruba a resposta (o envelope já morreu lá fora)", async () => {
    envelope("running");
    mockPropagate.mockRejectedValue(new Error("db down"));
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
  });

  it("envelope finalizado → 400 e nada de propagação", async () => {
    envelope("closed");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(400);
    expect(mockPropagate).not.toHaveBeenCalled();
  });

  it("sem PROPOSAL_CANCEL → 403 antes de tocar em qualquer coisa", async () => {
    mockLoad.mockResolvedValue({
      auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
      eff: { permissions: {} },
      proposal: { id: "p1", orgId: "org-1", status: "enviada", kind: "venda" },
    } as never);
    envelope("running");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(403);
    expect(mockCancelFlow).not.toHaveBeenCalled();
    expect(mockPropagate).not.toHaveBeenCalled();
  });

  it("propaga o 404 do escopo (envelope de outra proposta / outra org)", async () => {
    mockLoad.mockResolvedValue({
      fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }),
    } as never);
    const res = await DELETE(req(), params);
    expect(res.status).toBe(404);
    expect(mockPropagate).not.toHaveBeenCalled();
  });
});
