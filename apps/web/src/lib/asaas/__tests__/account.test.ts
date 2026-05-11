import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes do helper canônico de multi-account Asaas.
 *
 * Mocks: prisma + decryptSecret. Cobre:
 *  - owner sem grant tem todas as 4 capabilities implicitamente
 *  - non-owner sem grant tem 0 capabilities
 *  - resolveAsaasAccount prefere hint válido > active > primeira_acessivel
 *  - listAccessibleAccounts oculta arquivadas
 */

const mockMembership = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockAccountFindMany = vi.fn();
const mockOrgFindUnique = vi.fn();
const mockPermissionFindUnique = vi.fn();
const mockPermissionFindMany = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    orgMembership: {
      findUnique: (args: unknown) => mockMembership(args),
    },
    asaasAccount: {
      findUnique: (args: unknown) => mockAccountFindUnique(args),
      findFirst: (args: unknown) => mockAccountFindFirst(args),
      findMany: (args: unknown) => mockAccountFindMany(args),
    },
    organization: {
      findUnique: (args: unknown) => mockOrgFindUnique(args),
    },
    asaasAccountPermission: {
      findUnique: (args: unknown) => mockPermissionFindUnique(args),
      findMany: (args: unknown) => mockPermissionFindMany(args),
    },
  },
}));

vi.mock("@/lib/security/crypto", () => ({
  decryptSecret: () => "decrypted-test-key",
}));

import {
  isOrgOwner,
  userHasAccountCapability,
  listAccessibleAccounts,
  resolveAsaasAccount,
  getAccountCapabilitiesByUser,
  ACCOUNT_CAPABILITIES,
  maskWalletId,
} from "../account";

const ORG_ID = "org_1";
const USER_OWNER = "user_owner";
const USER_MEMBER = "user_member";
const ACCOUNT_A = "acc_a";
const ACCOUNT_B = "acc_b";
const ACCOUNT_ARCHIVED = "acc_archived";

const accountA = {
  id: ACCOUNT_A,
  orgId: ORG_ID,
  archivedAt: null,
  status: "APPROVED",
  walletId: "wal_aaaaaaaa1111",
  label: "Conta A",
  createdAt: new Date("2026-01-01"),
};
const accountB = {
  id: ACCOUNT_B,
  orgId: ORG_ID,
  archivedAt: null,
  status: "APPROVED",
  walletId: "wal_bbbbbbbb2222",
  label: "Conta B",
  createdAt: new Date("2026-02-01"),
};
const accountArchived = {
  id: ACCOUNT_ARCHIVED,
  orgId: ORG_ID,
  archivedAt: new Date("2026-03-01"),
  status: "APPROVED",
  walletId: "wal_zzzzzzzz9999",
  label: "Arquivada",
  createdAt: new Date("2025-12-01"),
};

beforeEach(() => {
  mockMembership.mockReset();
  mockAccountFindUnique.mockReset();
  mockAccountFindFirst.mockReset();
  mockAccountFindMany.mockReset();
  mockOrgFindUnique.mockReset();
  mockPermissionFindUnique.mockReset();
  mockPermissionFindMany.mockReset();
});

describe("isOrgOwner", () => {
  it("retorna true para role=owner", async () => {
    mockMembership.mockResolvedValue({ role: "owner" });
    expect(await isOrgOwner(USER_OWNER, ORG_ID)).toBe(true);
  });

  it("retorna false para role=admin/finance/member/null", async () => {
    mockMembership.mockResolvedValueOnce({ role: "admin" });
    expect(await isOrgOwner(USER_MEMBER, ORG_ID)).toBe(false);
    mockMembership.mockResolvedValueOnce(null);
    expect(await isOrgOwner(USER_MEMBER, ORG_ID)).toBe(false);
  });
});

describe("userHasAccountCapability", () => {
  it("owner sem grant explícito tem todas as 4 capabilities", async () => {
    mockAccountFindUnique.mockResolvedValue({
      orgId: ORG_ID,
      archivedAt: null,
    });
    mockMembership.mockResolvedValue({ role: "owner" });

    for (const cap of ACCOUNT_CAPABILITIES) {
      expect(
        await userHasAccountCapability(USER_OWNER, ACCOUNT_A, cap)
      ).toBe(true);
    }
    // Não consultou AsaasAccountPermission pra owner
    expect(mockPermissionFindUnique).not.toHaveBeenCalled();
  });

  it("non-owner sem grant tem 0 capabilities", async () => {
    mockAccountFindUnique.mockResolvedValue({
      orgId: ORG_ID,
      archivedAt: null,
    });
    mockMembership.mockResolvedValue({ role: "member" });
    mockPermissionFindUnique.mockResolvedValue(null);

    for (const cap of ACCOUNT_CAPABILITIES) {
      expect(
        await userHasAccountCapability(USER_MEMBER, ACCOUNT_A, cap)
      ).toBe(false);
    }
  });

  it("non-owner com grant específico tem apenas a capability liberada", async () => {
    mockAccountFindUnique.mockResolvedValue({
      orgId: ORG_ID,
      archivedAt: null,
    });
    mockMembership.mockResolvedValue({ role: "member" });
    // Liberou só "view"
    mockPermissionFindUnique.mockImplementation(({ where }: any) => {
      const cap = where?.accountId_userId_capability?.capability;
      return Promise.resolve(cap === "view" ? { id: "perm_1" } : null);
    });

    expect(await userHasAccountCapability(USER_MEMBER, ACCOUNT_A, "view")).toBe(true);
    expect(
      await userHasAccountCapability(USER_MEMBER, ACCOUNT_A, "create_charge")
    ).toBe(false);
    expect(
      await userHasAccountCapability(USER_MEMBER, ACCOUNT_A, "init_transfer")
    ).toBe(false);
    expect(
      await userHasAccountCapability(USER_MEMBER, ACCOUNT_A, "configure")
    ).toBe(false);
  });

  it("conta arquivada NUNCA tem capability ativa, mesmo pra owner", async () => {
    mockAccountFindUnique.mockResolvedValue({
      orgId: ORG_ID,
      archivedAt: new Date(),
    });
    mockMembership.mockResolvedValue({ role: "owner" });

    expect(
      await userHasAccountCapability(USER_OWNER, ACCOUNT_ARCHIVED, "view")
    ).toBe(false);
  });

  it("retorna false quando conta não existe", async () => {
    mockAccountFindUnique.mockResolvedValue(null);
    expect(
      await userHasAccountCapability(USER_OWNER, "nope", "view")
    ).toBe(false);
  });
});

describe("listAccessibleAccounts", () => {
  it("owner vê todas não-arquivadas, ordenadas por createdAt", async () => {
    mockMembership.mockResolvedValue({ role: "owner" });
    mockAccountFindMany.mockResolvedValue([accountA, accountB]);

    const list = await listAccessibleAccounts(USER_OWNER, ORG_ID);
    expect(list).toEqual([accountA, accountB]);
    // Filtro deve incluir archivedAt=null
    expect(mockAccountFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: ORG_ID, archivedAt: null },
      })
    );
  });

  it("non-owner sem grants retorna []", async () => {
    mockMembership.mockResolvedValue({ role: "member" });
    mockPermissionFindMany.mockResolvedValue([]);

    const list = await listAccessibleAccounts(USER_MEMBER, ORG_ID);
    expect(list).toEqual([]);
  });

  it("non-owner com grants em ≥1 conta vê só essas contas", async () => {
    mockMembership.mockResolvedValue({ role: "member" });
    mockPermissionFindMany.mockResolvedValue([{ accountId: ACCOUNT_A }]);
    mockAccountFindMany.mockResolvedValue([accountA]);

    const list = await listAccessibleAccounts(USER_MEMBER, ORG_ID);
    expect(list).toEqual([accountA]);
    expect(mockAccountFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [ACCOUNT_A] } },
      })
    );
  });
});

describe("resolveAsaasAccount", () => {
  it("hint válido + cap presente vence (reason=hint)", async () => {
    mockAccountFindFirst.mockResolvedValueOnce(accountB);
    // userHasAccountCapability lookups
    mockAccountFindUnique.mockResolvedValue({
      orgId: ORG_ID,
      archivedAt: null,
    });
    mockMembership.mockResolvedValue({ role: "owner" });

    const result = await resolveAsaasAccount({
      userId: USER_OWNER,
      orgId: ORG_ID,
      hintAccountId: ACCOUNT_B,
      requireCapability: "view",
    });
    expect(result?.account.id).toBe(ACCOUNT_B);
    expect(result?.reason).toBe("hint");
  });

  it("sem hint, cai pra activeAsaasAccountId da org (reason=active)", async () => {
    mockOrgFindUnique.mockResolvedValue({ activeAsaasAccountId: ACCOUNT_A });
    mockAccountFindFirst.mockResolvedValueOnce(accountA);
    mockAccountFindUnique.mockResolvedValue({
      orgId: ORG_ID,
      archivedAt: null,
    });
    mockMembership.mockResolvedValue({ role: "owner" });

    const result = await resolveAsaasAccount({
      userId: USER_OWNER,
      orgId: ORG_ID,
    });
    expect(result?.account.id).toBe(ACCOUNT_A);
    expect(result?.reason).toBe("active");
  });

  it("sem hint nem active, cai pra primeira acessível com a cap (reason=first_accessible)", async () => {
    mockOrgFindUnique.mockResolvedValue({ activeAsaasAccountId: null });
    mockMembership.mockResolvedValue({ role: "owner" });
    mockAccountFindMany.mockResolvedValue([accountA, accountB]);
    mockAccountFindUnique.mockResolvedValue({
      orgId: ORG_ID,
      archivedAt: null,
    });

    const result = await resolveAsaasAccount({
      userId: USER_OWNER,
      orgId: ORG_ID,
    });
    expect(result?.account.id).toBe(ACCOUNT_A);
    expect(result?.reason).toBe("first_accessible");
  });

  it("retorna null quando nenhuma conta satisfaz a cap", async () => {
    mockOrgFindUnique.mockResolvedValue({ activeAsaasAccountId: null });
    mockMembership.mockResolvedValue({ role: "member" });
    mockPermissionFindMany.mockResolvedValue([]);
    mockAccountFindMany.mockResolvedValue([]);

    const result = await resolveAsaasAccount({
      userId: USER_MEMBER,
      orgId: ORG_ID,
      requireCapability: "create_charge",
    });
    expect(result).toBeNull();
  });

  it("hint válido SEM cap requerida cai no fallback", async () => {
    // Hint resolve, mas user não tem cap → cai pra active
    mockAccountFindFirst
      .mockResolvedValueOnce(accountB) // hint
      .mockResolvedValueOnce(accountA); // active fallback
    mockOrgFindUnique.mockResolvedValue({ activeAsaasAccountId: ACCOUNT_A });
    // Member que tem cap só na conta A
    mockMembership.mockResolvedValue({ role: "member" });
    mockAccountFindUnique
      .mockResolvedValueOnce({ orgId: ORG_ID, archivedAt: null }) // hint check
      .mockResolvedValueOnce({ orgId: ORG_ID, archivedAt: null }); // active check
    mockPermissionFindUnique.mockImplementation(({ where }: any) => {
      const acc = where?.accountId_userId_capability?.accountId;
      return Promise.resolve(acc === ACCOUNT_A ? { id: "perm" } : null);
    });

    const result = await resolveAsaasAccount({
      userId: USER_MEMBER,
      orgId: ORG_ID,
      hintAccountId: ACCOUNT_B,
      requireCapability: "view",
    });
    expect(result?.account.id).toBe(ACCOUNT_A);
    expect(result?.reason).toBe("active");
  });
});

describe("getAccountCapabilitiesByUser", () => {
  it("owner: todas as 4 caps em todas as contas accessíveis", async () => {
    mockMembership.mockResolvedValue({ role: "owner" });
    mockAccountFindMany.mockResolvedValue([accountA, accountB]);

    const map = await getAccountCapabilitiesByUser(USER_OWNER, ORG_ID);
    expect(map[ACCOUNT_A]).toEqual([...ACCOUNT_CAPABILITIES]);
    expect(map[ACCOUNT_B]).toEqual([...ACCOUNT_CAPABILITIES]);
  });

  it("non-owner: agrupa grants por account", async () => {
    mockMembership.mockResolvedValue({ role: "member" });
    mockPermissionFindMany
      // 1ª chamada (listAccessibleAccounts → accountId distinct)
      .mockResolvedValueOnce([{ accountId: ACCOUNT_A }, { accountId: ACCOUNT_B }])
      // 2ª chamada (getAccountCapabilitiesByUser → grants completos)
      .mockResolvedValueOnce([
        { accountId: ACCOUNT_A, capability: "view" },
        { accountId: ACCOUNT_A, capability: "create_charge" },
        { accountId: ACCOUNT_B, capability: "view" },
      ]);
    mockAccountFindMany.mockResolvedValue([accountA, accountB]);

    const map = await getAccountCapabilitiesByUser(USER_MEMBER, ORG_ID);
    expect(map[ACCOUNT_A].sort()).toEqual(["create_charge", "view"]);
    expect(map[ACCOUNT_B]).toEqual(["view"]);
  });
});

describe("maskWalletId", () => {
  it("mascara walletId longo mantendo prefixo+sufixo", () => {
    expect(maskWalletId("wal_abcdef12345678ghij")).toBe("wal_abcd***ghij");
  });

  it("retorna walletId curto sem mascarar", () => {
    expect(maskWalletId("short")).toBe("short");
  });

  it("retorna em branco quando null/undefined", () => {
    expect(maskWalletId(null)).toBe("—");
    expect(maskWalletId(undefined)).toBe("—");
  });
});
