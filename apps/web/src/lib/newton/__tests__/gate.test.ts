import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { orgModule: { findMany: vi.fn() } },
}));

import { isNewtonEnabledForOrg, isNewtonEnabledForDeal, newtonDisabledResponse } from "../gate";
import { FEATURE, newtonFeatureForDealKind } from "@/lib/modules/catalog";
import { prisma } from "@/lib/db/prisma";

const mockFindMany = vi.mocked(prisma.orgModule.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

/** Rows como o banco devolve: módulo habilitado, overrides no featureFlags. */
function orgModules(flags: Record<string, Record<string, boolean>> = {}) {
  return [
    { module: "vendas", enabled: true, featureFlags: flags.vendas ?? {} },
    { module: "locacao", enabled: true, featureFlags: flags.locacao ?? {} },
  ];
}

describe("gate do Newton", () => {
  it("por padrão o Newton está DESLIGADO, mesmo com os dois módulos habilitados", async () => {
    // É a garantia que a RE/MAX depende: tenant novo não nasce com o Newton.
    mockFindMany.mockResolvedValue(orgModules());
    expect(await isNewtonEnabledForOrg("org-1")).toBe(false);
    expect(await isNewtonEnabledForDeal("org-1", "venda")).toBe(false);
    expect(await isNewtonEnabledForDeal("org-1", "locacao")).toBe(false);
  });

  it("ligar o Newton na locação não liga em vendas (e vice-versa)", async () => {
    mockFindMany.mockResolvedValue(orgModules({ locacao: { "locacao.newton": true } }));
    expect(await isNewtonEnabledForDeal("org-1", "locacao")).toBe(true);
    expect(await isNewtonEnabledForDeal("org-1", "venda")).toBe(false);
    // …mas a org "tem Newton" — as rotas Bearer, que não sabem o kind, liberam.
    expect(await isNewtonEnabledForOrg("org-1")).toBe(true);
  });

  it("newtonDisabledResponse devolve 403 MODULE_DISABLED quando desligado", async () => {
    mockFindMany.mockResolvedValue(orgModules());
    const res = await newtonDisabledResponse("org-1", "locacao");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toMatchObject({ error: "MODULE_DISABLED" });
  });

  it("newtonDisabledResponse devolve null (segue o fluxo) quando ligado", async () => {
    mockFindMany.mockResolvedValue(orgModules({ vendas: { "vendas.newton": true } }));
    expect(await newtonDisabledResponse("org-1", "venda")).toBeNull();
  });
});

describe("newtonFeatureForDealKind", () => {
  it("mapeia o kind do deal pra feature do módulo certo", () => {
    expect(newtonFeatureForDealKind("locacao")).toBe(FEATURE.LOCACAO_NEWTON);
    expect(newtonFeatureForDealKind("venda")).toBe(FEATURE.VENDAS_NEWTON);
    // Kind desconhecido cai em vendas (o default histórico de Deal.kind).
    expect(newtonFeatureForDealKind("")).toBe(FEATURE.VENDAS_NEWTON);
  });
});
