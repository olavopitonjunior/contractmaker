import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock local do Prisma — o guard só toca deal.findUnique e (via RBAC)
// orgMembership.findUnique.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    deal: { findUnique: vi.fn() },
    contract: { findUnique: vi.fn() },
    orgMembership: { findUnique: vi.fn() },
    orgManagerSettings: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(),
}));

import { prisma } from "@/lib/db/prisma";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { guardDealScope, guardContractScope } from "../route-helpers";

const mockDeal = vi.mocked(prisma.deal.findUnique);
const mockContract = vi.mocked(prisma.contract.findUnique);
const mockMembership = vi.mocked(prisma.orgMembership.findUnique);
const mockEffectiveUserId = vi.mocked(getEffectiveUserId);

const ORG = "org-ativa";
const ADMIN = "user-super-admin";
const OWNER = "user-dono-do-tenant";
const DEAL = "deal-locacao-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockDeal.mockResolvedValue({
    userId: OWNER,
    managerUserId: null,
    pipeline: { orgId: ORG },
  } as never);
  mockContract.mockResolvedValue({
    deal: { userId: OWNER, managerUserId: null, pipeline: { orgId: ORG } },
  } as never);
  // Só o OWNER é membro da org impersonada; o super_admin real não é.
  mockMembership.mockImplementation((async (args: {
    where: { userId_orgId: { userId: string; orgId: string } };
  }) =>
    args.where.userId_orgId.userId === OWNER
      ? { role: "owner", customRole: null }
      : null) as never);
});

/** Sem cookie de impersonation o helper devolve o próprio userId. */
function semImpersonation() {
  mockEffectiveUserId.mockImplementation(async (id: string) => id);
}

/** Sessão de impersonation ativa: o ator efetivo é o dono do tenant. */
function comImpersonation() {
  mockEffectiveUserId.mockResolvedValue(OWNER);
}

describe("guardDealScope sob impersonation", () => {
  it("super_admin impersonando um tenant passa no escopo (regressão do 404 do resumo)", async () => {
    comImpersonation();
    const denied = await guardDealScope({
      dealId: DEAL,
      userId: ADMIN,
      orgId: ORG,
    });
    // Antes do fix: getEffectivePermissions(ADMIN, ORG) = null → 404 "Não
    // encontrado", enquanto a PÁGINA do deal abria normalmente.
    expect(denied).toBeNull();
    expect(mockEffectiveUserId).toHaveBeenCalledWith(ADMIN);
  });

  it("sem impersonation, quem não é membro da org segue recebendo 404", async () => {
    semImpersonation();
    const denied = await guardDealScope({
      dealId: DEAL,
      userId: ADMIN,
      orgId: ORG,
    });
    expect(denied?.status).toBe(404);
  });

  it("membro legítimo continua passando", async () => {
    semImpersonation();
    const denied = await guardDealScope({
      dealId: DEAL,
      userId: OWNER,
      orgId: ORG,
    });
    expect(denied).toBeNull();
  });

  it("bearer não passa pelo escopo por usuário", async () => {
    semImpersonation();
    const denied = await guardDealScope({
      dealId: DEAL,
      userId: ADMIN,
      orgId: ORG,
      via: "bearer",
    });
    expect(denied).toBeNull();
    expect(mockEffectiveUserId).not.toHaveBeenCalled();
  });
});

describe("guardContractScope sob impersonation", () => {
  it("resolve o ator efetivo igual ao guard de deal", async () => {
    comImpersonation();
    const denied = await guardContractScope({
      contractId: "contract-1",
      userId: ADMIN,
      orgId: ORG,
    });
    expect(denied).toBeNull();
    expect(mockEffectiveUserId).toHaveBeenCalledWith(ADMIN);
  });

  it("sem impersonation, não-membro recebe 404", async () => {
    semImpersonation();
    const denied = await guardContractScope({
      contractId: "contract-1",
      userId: ADMIN,
      orgId: ORG,
    });
    expect(denied?.status).toBe(404);
  });
});
