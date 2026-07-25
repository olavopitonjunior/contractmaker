import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveNotificationUsers } from "../user-recipients";

const membershipMany = prisma.orgMembership.findMany as unknown as ReturnType<typeof vi.fn>;
const dealFind = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;

function member(userId: string, over: Record<string, unknown> = {}) {
  return {
    userId,
    user: { name: `Nome ${userId}`, phone: "+5511987654321", deletedAt: null },
    ...over,
  };
}

function notif(over: Record<string, unknown> = {}) {
  return {
    id: "n1",
    orgId: "org1",
    userId: null,
    type: "form_completed",
    linkUrl: null,
    metadata: null,
    ...over,
  };
}

describe("resolveNotificationUsers — cascata de destinatários", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipMany.mockResolvedValue([]);
    dealFind.mockResolvedValue(null);
  });

  it("notificação direcionada resolve só o alvo, mesmo havendo deal", async () => {
    membershipMany.mockResolvedValue([member("alvo")]);

    const r = await resolveNotificationUsers(
      notif({ userId: "alvo", metadata: { dealId: "deal1" } })
    );

    expect(r.rule).toBe("direct");
    expect(r.users.map((u) => u.userId)).toEqual(["alvo"]);
    // Não foi atrás do deal: o alvo já estava declarado.
    expect(dealFind).not.toHaveBeenCalled();
  });

  it("sem userId, usa o dono do deal do metadata", async () => {
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    membershipMany.mockResolvedValue([member("dono")]);

    const r = await resolveNotificationUsers(notif({ metadata: { dealId: "deal1" } }));

    expect(r.rule).toBe("deal_owner");
    expect(r.users.map((u) => u.userId)).toEqual(["dono"]);
  });

  it("cai pro linkUrl quando o metadata não traz dealId (certidao_problem)", async () => {
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    membershipMany.mockResolvedValue([member("dono")]);

    const r = await resolveNotificationUsers(
      notif({ type: "certidao_problem", linkUrl: "/deals/clx1234567890abcdefgh" })
    );

    expect(r.rule).toBe("deal_owner");
    expect(dealFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "clx1234567890abcdefgh" } })
    );
  });

  it("reconhece link de locação", async () => {
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    membershipMany.mockResolvedValue([member("dono")]);

    await resolveNotificationUsers(
      notif({ linkUrl: "/locacao/deals/clx1234567890abcdefgh" })
    );

    expect(dealFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "clx1234567890abcdefgh" } })
    );
  });

  it("deal de OUTRA org não vaza o dono — cai pro fallback de admins", async () => {
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org-outra" } });
    membershipMany.mockResolvedValue([member("admin1")]);

    const r = await resolveNotificationUsers(notif({ metadata: { dealId: "deal1" } }));

    expect(r.rule).toBe("org_admins");
    expect(r.users.map((u) => u.userId)).toEqual(["admin1"]);
  });

  it("org-wide sem deal vai pros owners/admins, limitado a 5", async () => {
    const admins = Array.from({ length: 9 }, (_, i) => ({ userId: `a${i}` }));
    membershipMany
      .mockResolvedValueOnce(admins.slice(0, 5)) // take: 5 na query de admins
      .mockResolvedValueOnce(admins.slice(0, 5).map((a) => member(a.userId)));

    const r = await resolveNotificationUsers(notif({ type: "ai_budget_threshold" }));

    expect(r.rule).toBe("org_admins");
    expect(r.users).toHaveLength(5);
    expect(membershipMany.mock.calls[0][0]).toMatchObject({
      where: { orgId: "org1", role: { in: ["owner", "admin"] } },
      take: 5,
    });
  });

  it("ex-membro não recebe: sem OrgMembership, some da lista", async () => {
    membershipMany.mockResolvedValue([]); // saiu da org

    const r = await resolveNotificationUsers(notif({ userId: "ex-membro" }));

    expect(r.users).toEqual([]);
  });

  it("conta com soft-delete (LGPD) é excluída", async () => {
    membershipMany.mockResolvedValue([
      member("morto", {
        user: { name: "X", phone: "+5511987654321", deletedAt: new Date() },
      }),
    ]);

    const r = await resolveNotificationUsers(notif({ userId: "morto" }));

    expect(r.users).toEqual([]);
  });

  it("erro de DB não propaga", async () => {
    membershipMany.mockRejectedValue(new Error("db caiu"));

    await expect(
      resolveNotificationUsers(notif({ userId: "x" }))
    ).resolves.toEqual({ users: [], rule: "none" });
  });
});
