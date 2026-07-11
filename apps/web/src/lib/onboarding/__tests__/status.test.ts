import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getOnboardingStatus } from "../status";

const orgFind = prisma.organization.findUnique as unknown as ReturnType<typeof vi.fn>;
const gAcc = prisma.orgGoogleAccount.findUnique as unknown as ReturnType<typeof vi.fn>;
const tmplCount = prisma.contractTemplate.count as unknown as ReturnType<typeof vi.fn>;
const formFind = prisma.orgFormSettings.findUnique as unknown as ReturnType<typeof vi.fn>;
const inviteCount = prisma.orgInvitation.count as unknown as ReturnType<typeof vi.fn>;
const memberCount = prisma.orgMembership.count as unknown as ReturnType<typeof vi.fn>;
const dealCount = prisma.deal.count as unknown as ReturnType<typeof vi.fn>;
const orgModuleFindMany = prisma.orgModule.findMany as unknown as ReturnType<typeof vi.fn>;

const T0 = new Date("2026-07-01T10:00:00Z");
const T1 = new Date("2026-07-01T10:05:00Z");

describe("getOnboardingStatus (6 passos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgModuleFindMany.mockResolvedValue([]); // fail-open → módulos habilitados
    orgFind.mockResolvedValue({ creci: null, legalName: null, onboardingCompletedAt: null });
    gAcc.mockResolvedValue(null);
    tmplCount.mockResolvedValue(0);
    formFind.mockResolvedValue(null);
    inviteCount.mockResolvedValue(0);
    memberCount.mockResolvedValue(0);
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
    formFind.mockResolvedValue({ preset: "completo", customRequiredPaths: [], createdAt: T0, updatedAt: T1 });
    inviteCount.mockResolvedValue(1);
    dealCount.mockResolvedValue(1);
    const s = await getOnboardingStatus("org1");
    expect(s.requiredDone).toBe(6);
    expect(s.complete).toBe(true);
  });

  it("form completa com QUALQUER save real (updatedAt > createdAt), mesmo preset legado", async () => {
    formFind.mockResolvedValue({
      preset: "legado",
      customRequiredPaths: [],
      createdAt: T0,
      updatedAt: T1,
    });
    const s = await getOnboardingStatus("org1");
    expect(s.steps.find((x) => x.key === "form")?.done).toBe(true);
  });

  it("form NÃO completa quando só a row lazy existe (updatedAt == createdAt, legado)", async () => {
    formFind.mockResolvedValue({
      preset: "legado",
      customRequiredPaths: [],
      createdAt: T0,
      updatedAt: T0,
    });
    const s = await getOnboardingStatus("org1");
    expect(s.steps.find((x) => x.key === "form")?.done).toBe(false);
  });

  it("invite completa por convite OU por membro extra (fallback)", async () => {
    // sem convite, mas há um membro além do owner
    memberCount.mockResolvedValue(1);
    const s = await getOnboardingStatus("org1");
    expect(s.steps.find((x) => x.key === "invite")?.done).toBe(true);
    // deal ainda escopado por pipeline.orgId
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
