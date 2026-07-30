import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock local do Prisma (sobrepõe o do setup global, que não conhece
// orgManagerSettings nem orgMembership.findUnique).
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    orgManagerSettings: { findUnique: vi.fn() },
    orgMembership: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import { resolveManagerForCreate, getManagerSettings } from "../manager";

const mockSettings = vi.mocked(prisma.orgManagerSettings.findUnique);
const mockMembership = vi.mocked(prisma.orgMembership.findUnique);

const ORG = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Toggle desligado (row existente com managerRequired=false). */
function toggleOff() {
  mockSettings.mockResolvedValue({
    managerRequired: false,
    permissionsJson: {},
  } as never);
}

/** Toggle ligado. */
function toggleOn() {
  mockSettings.mockResolvedValue({
    managerRequired: true,
    permissionsJson: {},
  } as never);
}

describe("resolveManagerForCreate", () => {
  it("toggle off + sem gerente → ok com managerUserId null", async () => {
    toggleOff();
    const r = await resolveManagerForCreate(ORG, undefined);
    expect(r).toEqual({ ok: true, managerUserId: null });
    // Sem gerente informado não há por que consultar membership.
    expect(mockMembership).not.toHaveBeenCalled();
  });

  it("row de settings ausente conta como toggle off", async () => {
    mockSettings.mockResolvedValue(null as never);
    const r = await resolveManagerForCreate(ORG, null);
    expect(r).toEqual({ ok: true, managerUserId: null });
  });

  it("toggle off + gerente membro → ok com o id informado", async () => {
    toggleOff();
    mockMembership.mockResolvedValue({ userId: "u-gerente" } as never);

    const r = await resolveManagerForCreate(ORG, "u-gerente");
    expect(r).toEqual({ ok: true, managerUserId: "u-gerente" });
    expect(mockMembership).toHaveBeenCalledWith({
      where: { userId_orgId: { userId: "u-gerente", orgId: ORG } },
      select: { userId: true },
    });
  });

  it("toggle on + sem gerente → 422 gerente_obrigatorio", async () => {
    toggleOn();
    const r = await resolveManagerForCreate(ORG, undefined);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperava falha");
    expect(r.status).toBe(422);
    expect(r.error).toBe("gerente_obrigatorio");
    expect(r.message).toMatch(/gerente/i);
  });

  it("toggle on + string vazia também é ausência → 422", async () => {
    toggleOn();
    const r = await resolveManagerForCreate(ORG, "");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperava falha");
    expect(r.error).toBe("gerente_obrigatorio");
  });

  it("gerente não-membro da org → 400 gerente_invalido", async () => {
    toggleOff();
    mockMembership.mockResolvedValue(null as never);

    const r = await resolveManagerForCreate(ORG, "u-de-outra-org");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperava falha");
    expect(r.status).toBe(400);
    expect(r.error).toBe("gerente_invalido");
  });

  it("toggle on + gerente membro → ok (validação de membership vale igual)", async () => {
    toggleOn();
    mockMembership.mockResolvedValue({ userId: "u-gerente" } as never);

    const r = await resolveManagerForCreate(ORG, "u-gerente");
    expect(r).toEqual({ ok: true, managerUserId: "u-gerente" });
  });
});

describe("getManagerSettings", () => {
  it("row ausente → defaults (toggle off, permissões vazias)", async () => {
    mockSettings.mockResolvedValue(null as never);
    await expect(getManagerSettings(ORG)).resolves.toEqual({
      managerRequired: false,
      permissionsJson: {},
    });
  });

  it("devolve o que está na row", async () => {
    mockSettings.mockResolvedValue({
      managerRequired: true,
      permissionsJson: { verTodosNegocios: true },
    } as never);
    await expect(getManagerSettings(ORG)).resolves.toEqual({
      managerRequired: true,
      permissionsJson: { verTodosNegocios: true },
    });
  });
});
