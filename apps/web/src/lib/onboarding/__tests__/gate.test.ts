import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { canSeeOnboarding, resolveOnboardingActor } from "../gate";

// Impersonation é resolvida por request (cookies/headers); no unit test o id
// efetivo é o próprio usuário, salvo quando o teste sobrescreve o mock.
vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (userId: string) => userId),
}));
import { getEffectiveUserId } from "@/lib/auth/impersonation";

const membershipFind = prisma.orgMembership.findFirst as unknown as ReturnType<typeof vi.fn>;
const effUser = getEffectiveUserId as unknown as ReturnType<typeof vi.fn>;

describe("canSeeOnboarding (owner|admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    effUser.mockImplementation(async (userId: string) => userId);
  });

  it("owner vê o onboarding", async () => {
    membershipFind.mockResolvedValue({ role: "owner" });
    await expect(canSeeOnboarding("u1", "org1")).resolves.toBe(true);
  });

  it("admin vê o onboarding (também configura o tenant)", async () => {
    membershipFind.mockResolvedValue({ role: "admin" });
    await expect(canSeeOnboarding("u1", "org1")).resolves.toBe(true);
  });

  it.each(["member", "finance", "sales", "viewer", "custom"])(
    "role %s NÃO vê o onboarding",
    async (role) => {
      membershipFind.mockResolvedValue({ role });
      await expect(canSeeOnboarding("u1", "org1")).resolves.toBe(false);
    }
  );

  it("sem membership na org → não vê", async () => {
    membershipFind.mockResolvedValue(null);
    await expect(canSeeOnboarding("u1", "org1")).resolves.toBe(false);
  });

  it("consulta a membership do usuário EFETIVO (impersonation-aware)", async () => {
    effUser.mockResolvedValue("owner-da-org");
    membershipFind.mockResolvedValue({ role: "owner" });

    const { effUserId, isOwnerAdmin } = await resolveOnboardingActor("super-admin", "org1");

    expect(effUserId).toBe("owner-da-org");
    expect(isOwnerAdmin).toBe(true);
    expect(membershipFind).toHaveBeenCalledWith({
      where: { userId: "owner-da-org", orgId: "org1" },
      select: { role: true },
    });
  });
});
