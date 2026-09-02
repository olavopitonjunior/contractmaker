import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

// Impersonação: fora dela o helper devolve o próprio id. O guard depende
// disso, então o mock é identidade — o caso de impersonação tem cobertura
// própria no guardDealScope.
vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

import { guardDealCreate } from "../route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

const membershipFind = prisma.orgMembership
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const managerSettingsFind = prisma.orgManagerSettings
  .findUnique as unknown as ReturnType<typeof vi.fn>;

function asMember(role: string) {
  membershipFind.mockResolvedValue({
    userId: "u1",
    orgId: "org-1",
    role,
    customRole: null,
  });
}

async function guard(via?: string) {
  return guardDealCreate({
    userId: "u1",
    orgId: "org-1",
    via,
    permission: PERMISSION.DEAL_CREATE,
  });
}

describe("guardDealCreate — gate de criação de negócio de venda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerSettingsFind.mockResolvedValue(null);
  });

  it("NEGA sessão de viewer com 403 — o buraco que o gate fecha", async () => {
    asMember("viewer");
    const res = await guard("session");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toMatchObject({
      error: "PERMISSION_DENIED",
      permission: "deal.create",
    });
  });

  it("PERMITE sessão de admin — quem já criava não perde", async () => {
    asMember("admin");
    expect(await guard("session")).toBeNull();
  });

  it("PERMITE sessão de gerente — retrocompat medida em produção", async () => {
    asMember("gerente");
    expect(await guard("session")).toBeNull();
  });

  it("NEGA quem não é membro da org", async () => {
    membershipFind.mockResolvedValue(null);
    const res = await guard("session");
    expect(res!.status).toBe(403);
  });

  it("deixa Bearer passar SEM consultar permissão (escopo do token governa)", async () => {
    // Espelha guardDealScope/loadScopedDeal. A asserção que importa é a
    // segunda: não basta devolver null, tem de nem chegar ao banco — é isso
    // que garante que o Max não para quando o gate entra.
    asMember("viewer");
    expect(await guard("bearer")).toBeNull();
    expect(membershipFind).not.toHaveBeenCalled();
  });
});
