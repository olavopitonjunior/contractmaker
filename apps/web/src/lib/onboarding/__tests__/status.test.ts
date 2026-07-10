import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getOnboardingStatus } from "../status";

const orgFind = prisma.organization.findUnique as unknown as ReturnType<typeof vi.fn>;
const gAcc = prisma.orgGoogleAccount.findUnique as unknown as ReturnType<typeof vi.fn>;
const tmplCount = prisma.contractTemplate.count as unknown as ReturnType<typeof vi.fn>;
const formCount = prisma.orgFormSettings.count as unknown as ReturnType<typeof vi.fn>;
const inviteCount = prisma.orgInvitation.count as unknown as ReturnType<typeof vi.fn>;
const dealCount = prisma.deal.count as unknown as ReturnType<typeof vi.fn>;
const orgModuleFindMany = prisma.orgModule.findMany as unknown as ReturnType<typeof vi.fn>;

describe("getOnboardingStatus (6 passos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgModuleFindMany.mockResolvedValue([]); // fail-open → módulos habilitados
    orgFind.mockResolvedValue({ creci: null, legalName: null, onboardingCompletedAt: null });
    gAcc.mockResolvedValue(null);
    tmplCount.mockResolvedValue(0);
    formCount.mockResolvedValue(0);
    inviteCount.mockResolvedValue(0);
    dealCount.mockResolvedValue(0);
  });

  it("org nova: 6 passos obrigatórios, nenhum feito, incompleto", async () => {
    const s = await getOnboardingStatus("org1");
    expect(s.steps.map((x) => x.key)).toEqual([
      "google",
      "profile",
      "templates",
      "form",
      "invite",
      "deal",
    ]);
    expect(s.requiredTotal).toBe(6);
    expect(s.requiredDone).toBe(0);
    expect(s.complete).toBe(false);
    expect(s.steps.every((x) => x.required)).toBe(true);
  });

  it("tudo configurado → 6/6 e complete", async () => {
    orgFind.mockResolvedValue({
      creci: "12345-J",
      legalName: "Imobiliária X",
      onboardingCompletedAt: null,
    });
    gAcc.mockResolvedValue({ status: "connected" });
    tmplCount.mockResolvedValue(1);
    formCount.mockResolvedValue(1);
    inviteCount.mockResolvedValue(1);
    dealCount.mockResolvedValue(1);
    const s = await getOnboardingStatus("org1");
    expect(s.requiredDone).toBe(6);
    expect(s.complete).toBe(true);
  });

  it("form só conta com preset ≠ legado; deal via pipeline.orgId", async () => {
    formCount.mockResolvedValue(1);
    dealCount.mockResolvedValue(2);
    const s = await getOnboardingStatus("org1");
    expect(s.steps.find((x) => x.key === "form")?.done).toBe(true);
    expect(s.steps.find((x) => x.key === "deal")?.done).toBe(true);
    // a query de form filtra preset != "legado"
    expect(formCount).toHaveBeenCalledWith({
      where: { orgId: "org1", preset: { not: "legado" } },
    });
    // deal escopado por pipeline.orgId
    expect(dealCount).toHaveBeenCalledWith({ where: { pipeline: { orgId: "org1" } } });
  });

  it("profile: detail aponta o campo faltante", async () => {
    orgFind.mockResolvedValue({
      creci: null,
      legalName: "Imobiliária X",
      onboardingCompletedAt: null,
    });
    const s = await getOnboardingStatus("org1");
    const profile = s.steps.find((x) => x.key === "profile")!;
    expect(profile.done).toBe(false);
    expect(profile.detail).toContain("CRECI");
  });
});
