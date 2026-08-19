import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/require-auth", () => ({
  requireApiAuth: vi.fn().mockResolvedValue({
    org: { id: "org-1" },
    actor: { effectiveUserId: "u1" },
  }),
  isAuthFailure: vi.fn().mockReturnValue(false),
  authFailureResponse: vi.fn(),
}));
vi.mock("@/lib/security/rbac/check", () => ({
  getEffectivePermissions: vi.fn().mockResolvedValue({}),
  canAccessProposal: vi.fn().mockReturnValue(true),
  can: vi.fn().mockReturnValue(true),
}));

import { loadScopedPlanSigner } from "../scoped-signer";
import { prisma } from "@/lib/db/prisma";

const propFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const envSignerFind = prisma.envelopeSigner.findUnique as unknown as ReturnType<typeof vi.fn>;
const planSignerFind = prisma.proposalSigner.findUnique as unknown as ReturnType<typeof vi.fn>;

const req = () => new NextRequest("http://localhost/api/proposals/p1/signers/s1");

const proposal = (status: string) => ({
  orgId: "org-1",
  userId: "u1",
  responsibleUserId: null,
  status,
});

const planRow = (acceptance: { id?: string | null; status?: string | null } = {}) => ({
  id: "s1",
  proposalId: "p1",
  acceptanceClicksignId: acceptance.id ?? null,
  acceptanceStatus: acceptance.status ?? null,
});

describe("loadScopedPlanSigner — guards de status e de termo emitido (2026-08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envSignerFind.mockResolvedValue(null);
  });

  it.each(["rascunho", "assinada_proponente", "aguardando_vendedor", "enviada"])(
    "linha SEM termo em %s (não-terminal) → resolve normalmente",
    async (status) => {
      propFindUnique.mockResolvedValue(proposal(status));
      planSignerFind.mockResolvedValue(planRow());
      const r = await loadScopedPlanSigner(req(), "p1", "s1", "edit");
      expect("fail" in r).toBe(false);
      if (!("fail" in r)) expect(r.kind).toBe("plan");
    }
  );

  it.each(["completa", "convertida", "expirada", "cancelada", "recusada_vendedor"])(
    "proposta TERMINAL (%s) → 409 (paridade com o POST /signers)",
    async (status) => {
      propFindUnique.mockResolvedValue(proposal(status));
      planSignerFind.mockResolvedValue(planRow());
      const r = await loadScopedPlanSigner(req(), "p1", "s1", "edit");
      expect("fail" in r).toBe(true);
      if ("fail" in r) expect(r.fail.status).toBe(409);
    }
  );

  it.each(["edit", "remove"] as const)(
    "termo VIVO (sent) → 409 pra %s (âncora do webhook; nunca mexer)",
    async (action) => {
      propFindUnique.mockResolvedValue(proposal("aguardando_vendedor"));
      planSignerFind.mockResolvedValue(planRow({ id: "acc_1", status: "sent" }));
      const r = await loadScopedPlanSigner(req(), "p1", "s1", action);
      expect("fail" in r).toBe(true);
      if ("fail" in r) expect(r.fail.status).toBe(409);
    }
  );

  it("termo MORTO (expired) → EDITAR permitido (corrigir contato antes da reemissão)", async () => {
    propFindUnique.mockResolvedValue(proposal("assinada_proponente"));
    planSignerFind.mockResolvedValue(planRow({ id: "acc_dead", status: "expired" }));
    const r = await loadScopedPlanSigner(req(), "p1", "s1", "edit");
    expect("fail" in r).toBe(false);
    if (!("fail" in r)) expect(r.kind).toBe("plan");
  });

  it("termo MORTO (expired) → REMOVER bloqueado (webhook tardio ainda resolve pela linha)", async () => {
    propFindUnique.mockResolvedValue(proposal("assinada_proponente"));
    planSignerFind.mockResolvedValue(planRow({ id: "acc_dead", status: "expired" }));
    const r = await loadScopedPlanSigner(req(), "p1", "s1", "remove");
    expect("fail" in r).toBe(true);
    if ("fail" in r) expect(r.fail.status).toBe(409);
  });

  it("EnvelopeSigner existente mas de OUTRA proposta → 404 explícito (sem fallthrough pro plano)", async () => {
    propFindUnique.mockResolvedValue(proposal("rascunho"));
    envSignerFind.mockResolvedValue({
      id: "s1",
      envelope: { proposalId: "OUTRA", orgId: "org-1", source: "proposal" },
    });
    // Se houvesse fallthrough, este plano homônimo seria devolvido — não deve.
    planSignerFind.mockResolvedValue(planRow());
    const r = await loadScopedPlanSigner(req(), "p1", "s1", "edit");
    expect("fail" in r).toBe(true);
    if ("fail" in r) expect(r.fail.status).toBe(404);
    expect(planSignerFind).not.toHaveBeenCalled();
  });

  it("EnvelopeSigner no escopo → kind envelope (caminho original preservado)", async () => {
    propFindUnique.mockResolvedValue(proposal("aguardando_vendedor"));
    envSignerFind.mockResolvedValue({
      id: "s1",
      envelope: { proposalId: "p1", orgId: "org-1", source: "proposal" },
    });
    const r = await loadScopedPlanSigner(req(), "p1", "s1", "edit");
    expect("fail" in r).toBe(false);
    if (!("fail" in r)) expect(r.kind).toBe("envelope");
  });
});
