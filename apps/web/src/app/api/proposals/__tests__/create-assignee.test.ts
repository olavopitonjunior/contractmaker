import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/require-auth", () => ({
  requireApiAuth: vi.fn(),
  isAuthFailure: (v: unknown) => v == null || typeof v !== "object" || !("org" in (v as object)),
  authFailureResponse: vi.fn(),
}));
vi.mock("@/lib/security/rbac/check", () => ({
  getEffectivePermissions: vi.fn(),
  proposalScopeWhere: vi.fn(),
  can: vi.fn(),
}));
vi.mock("@/lib/modules/guard", () => ({
  assertFeatureEnabled: vi.fn().mockResolvedValue(undefined),
  ModuleDisabledError: class extends Error {},
}));
vi.mock("@/lib/api/idempotency", () => ({
  // Executa o handler direto — o teste é do fluxo, não da idempotência.
  withIdempotency: vi.fn(async ({ handler }: { handler: () => unknown }) => handler()),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

import { POST } from "../route";
import { requireApiAuth } from "@/lib/api/require-auth";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { prisma } from "@/lib/db/prisma";

const mockAuth = vi.mocked(requireApiAuth);
const mockCan = vi.mocked(can);
const mockPrisma = vi.mocked(prisma);

function req(body: unknown) {
  return new NextRequest("http://localhost/api/proposals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const baseBody = { title: "Proposta X", schemaType: "compra_venda_v1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    org: { id: "org-1" },
    actor: { effectiveUserId: "admin-1" },
  } as never);
  mockPrisma.proposal.create.mockResolvedValue({ id: "p1", kind: "venda" } as never);
});

/** can() por permissão — CREATE sempre; ASSIGN configurável. */
function grant({ assign }: { assign: boolean }) {
  mockCan.mockImplementation(
    (_eff: unknown, perm: unknown) =>
      perm === PERMISSION.PROPOSAL_CREATE || (assign && perm === PERMISSION.PROPOSAL_ASSIGN)
  );
}

describe("POST /api/proposals — responsável na criação", () => {
  it("grava responsibleUserId quando o criador tem PROPOSAL_ASSIGN e o alvo é membro", async () => {
    grant({ assign: true });
    mockPrisma.orgMembership.findUnique.mockResolvedValue({ userId: "gerente-1" } as never);

    const res = await POST(req({ ...baseBody, responsibleUserId: "gerente-1" }));

    expect(res.status).toBe(201);
    expect(mockPrisma.proposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responsibleUserId: "gerente-1",
          responsibleName: null,
        }),
      })
    );
  });

  it("403 sem PROPOSAL_ASSIGN — criar continua permitido, atribuir não", async () => {
    grant({ assign: false });

    const res = await POST(req({ ...baseBody, responsibleUserId: "gerente-1" }));

    expect(res.status).toBe(403);
    expect(mockPrisma.proposal.create).not.toHaveBeenCalled();
  });

  it("400 quando o responsável não é membro da org", async () => {
    grant({ assign: true });
    mockPrisma.orgMembership.findUnique.mockResolvedValue(null as never);

    const res = await POST(req({ ...baseBody, responsibleUserId: "intruso" }));

    expect(res.status).toBe(400);
    expect(mockPrisma.proposal.create).not.toHaveBeenCalled();
  });

  it("400 quando manda responsibleUserId E responsibleName juntos", async () => {
    grant({ assign: true });

    const res = await POST(
      req({ ...baseBody, responsibleUserId: "gerente-1", responsibleName: "Corretor Y" })
    );

    expect(res.status).toBe(400);
    expect(mockPrisma.proposal.create).not.toHaveBeenCalled();
  });

  it("sem responsável segue como antes (criador vira dono, sem atribuição)", async () => {
    grant({ assign: false });

    const res = await POST(req(baseBody));

    expect(res.status).toBe(201);
    expect(mockPrisma.proposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "admin-1",
          responsibleUserId: null,
          responsibleName: null,
        }),
      })
    );
  });
});
