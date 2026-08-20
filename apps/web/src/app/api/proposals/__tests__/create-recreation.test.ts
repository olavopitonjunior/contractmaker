import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Thread de recriação no POST /api/proposals (`parentProposalId`): guard de
 * org + ESCOPO do ator sobre o pai (o handler escreve nele — supersededById e
 * evento), herança de round e os 2 ProposalEvents. Mesmo padrão de mocks do
 * create-assignee.test.ts ao lado.
 */
vi.mock("@/lib/api/require-auth", () => ({
  requireApiAuth: vi.fn(),
  isAuthFailure: (v: unknown) => v == null || typeof v !== "object" || !("org" in (v as object)),
  authFailureResponse: vi.fn(),
}));
vi.mock("@/lib/security/rbac/check", () => ({
  getEffectivePermissions: vi.fn(),
  proposalScopeWhere: vi.fn(),
  can: vi.fn(),
  canAccessProposal: vi.fn(),
}));
vi.mock("@/lib/modules/guard", () => ({
  assertFeatureEnabled: vi.fn().mockResolvedValue(undefined),
  ModuleDisabledError: class extends Error {},
}));
vi.mock("@/lib/api/idempotency", () => ({
  withIdempotency: vi.fn(async ({ handler }: { handler: () => unknown }) => handler()),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

import { POST } from "../route";
import { requireApiAuth } from "@/lib/api/require-auth";
import {
  can,
  canAccessProposal,
  getEffectivePermissions,
} from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { prisma } from "@/lib/db/prisma";

const mockAuth = vi.mocked(requireApiAuth);
const mockCan = vi.mocked(can);
const mockCanAccess = vi.mocked(canAccessProposal);
const mockPrisma = vi.mocked(prisma);

function req(body: unknown) {
  return new NextRequest("http://localhost/api/proposals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const baseBody = { title: "Recriação", schemaType: "compra_venda_v1" };
const parentRow = {
  id: "parent-1",
  orgId: "org-1",
  code: "PROP-2026-0006",
  round: 2,
  userId: "dono-1",
  responsibleUserId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    org: { id: "org-1" },
    actor: { effectiveUserId: "corretor-1" },
  } as never);
  mockCan.mockImplementation(
    (_eff: unknown, perm: unknown) => perm === PERMISSION.PROPOSAL_CREATE
  );
  // `eff` precisa ser truthy — o guard do parent tem `!eff` (narrowing do TS)
  // e um mock undefined derrubaria tudo em 404 sem exercitar o escopo.
  vi.mocked(getEffectivePermissions).mockResolvedValue({} as never);
  mockCanAccess.mockReturnValue(true);
  mockPrisma.proposal.create.mockResolvedValue({
    id: "child-1",
    kind: "venda",
    code: "PROP-2026-0014",
  } as never);
  mockPrisma.$queryRaw.mockResolvedValue([{ value: 14 }] as never);
});

describe("POST /api/proposals — parentProposalId (recriação)", () => {
  it("pai de OUTRA org → 404 e nada é criado nem escrito no pai", async () => {
    mockPrisma.proposal.findUnique.mockResolvedValue({
      ...parentRow,
      orgId: "org-2",
    } as never);

    const res = await POST(req({ ...baseBody, parentProposalId: "parent-1" }));

    expect(res.status).toBe(404);
    expect(mockPrisma.proposal.create).not.toHaveBeenCalled();
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
  });

  it("pai fora do ESCOPO do ator → 404 (o handler escreve no pai; VIEW_OWN_ONLY não recria proposta de colega)", async () => {
    mockPrisma.proposal.findUnique.mockResolvedValue(parentRow as never);
    mockCanAccess.mockReturnValue(false);

    const res = await POST(req({ ...baseBody, parentProposalId: "parent-1" }));

    expect(res.status).toBe(404);
    expect(mockCanAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "dono-1",
        responsibleUserId: null,
      })
    );
    expect(mockPrisma.proposal.create).not.toHaveBeenCalled();
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
  });

  it("caminho feliz: filha herda round+1, pai ganha supersededById e os 2 eventos são gravados", async () => {
    mockPrisma.proposal.findUnique.mockResolvedValue(parentRow as never);

    const res = await POST(req({ ...baseBody, parentProposalId: "parent-1" }));

    expect(res.status).toBe(201);
    expect(mockPrisma.proposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentProposalId: "parent-1",
          round: 3,
        }),
      })
    );
    expect(mockPrisma.proposal.update).toHaveBeenCalledWith({
      where: { id: "parent-1" },
      data: { supersededById: "child-1" },
    });
    expect(mockPrisma.proposalEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          proposalId: "parent-1",
          eventName: "superseded_by_recreation",
        }),
        expect.objectContaining({
          proposalId: "child-1",
          eventName: "recreated_from",
        }),
      ],
    });
  });

  it("sem parentProposalId: round default (não vai no create) e pai não é tocado", async () => {
    const res = await POST(req(baseBody));

    expect(res.status).toBe(201);
    const data = mockPrisma.proposal.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.parentProposalId).toBeUndefined();
    expect(data.round).toBeUndefined();
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
    expect(mockPrisma.proposalEvent.createMany).not.toHaveBeenCalled();
  });
});
