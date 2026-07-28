import { describe, it, expect, vi, beforeEach } from "vitest";
import { audit } from "../audit";
import { prisma } from "@/lib/db/prisma";
import { getImpersonationAuditMeta } from "@/lib/auth/impersonation";

/**
 * Sob impersonation o AuditLog grava `userId` = ator EFETIVO (o dono do tenant).
 * O carimbo `impersonatedBy` é o que distingue "o dono fez" de "o super_admin fez
 * pelo dono" — sem ele a trilha some. Ver lib/auth/impersonation.ts.
 */
vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationAuditMeta: vi.fn(),
}));

const mockPrisma = vi.mocked(prisma);
const mockMeta = vi.mocked(getImpersonationAuditMeta);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("audit() — carimbo de impersonation", () => {
  it("com impersonation ativa na MESMA org: carimba impersonatedBy + sessionId", async () => {
    mockMeta.mockResolvedValue({
      orgId: "org-tenant",
      adminUserId: "admin-1",
      sessionId: "imp-1",
    });

    await audit(
      { orgId: "org-tenant", userId: "owner-9" },
      { action: "DEAL_CREATE", result: "SUCCESS", metadata: { dealId: "d1" } }
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: "org-tenant",
          userId: "owner-9",
          metadata: expect.objectContaining({
            dealId: "d1",
            impersonated: true,
            impersonatedBy: "admin-1",
            impersonationSessionId: "imp-1",
          }),
        }),
      })
    );
  });

  it("impersonation de OUTRA org não contamina o log (cron/webhook concorrente)", async () => {
    mockMeta.mockResolvedValue({
      orgId: "org-outra",
      adminUserId: "admin-1",
      sessionId: "imp-1",
    });

    await audit(
      { orgId: "org-tenant", userId: "owner-9" },
      { action: "DEAL_CREATE", result: "SUCCESS" }
    );

    const data = mockPrisma.auditLog.create.mock.calls[0][0].data as {
      metadata?: Record<string, unknown>;
    };
    expect(data.metadata?.impersonatedBy).toBeUndefined();
  });

  it("sem impersonation: metadata intacta", async () => {
    mockMeta.mockResolvedValue(null);

    await audit(
      { orgId: "org-1", userId: "u1" },
      { action: "DEAL_CREATE", result: "SUCCESS", metadata: { dealId: "d1" } }
    );

    const data = mockPrisma.auditLog.create.mock.calls[0][0].data as {
      metadata?: Record<string, unknown>;
    };
    expect(data.metadata).toEqual({ dealId: "d1" });
  });

  it("falha ao resolver impersonation não derruba o audit", async () => {
    mockMeta.mockRejectedValue(new Error("fora de request scope"));

    await audit({ orgId: "org-1", userId: "u1" }, { action: "DEAL_CREATE", result: "SUCCESS" });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
