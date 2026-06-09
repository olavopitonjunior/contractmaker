import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getOrgModules, isModuleEnabled, isFeatureEnabled } from "./read";
import { assertModuleEnabled, assertFeatureEnabled, ModuleDisabledError } from "./guard";
import { MODULE, FEATURE } from "./catalog";

const findMany = prisma.orgModule.findMany as unknown as ReturnType<typeof vi.fn>;

describe("getOrgModules — fail-open", () => {
  beforeEach(() => vi.clearAllMocks());

  it("org sem nenhuma row => ambos os módulos habilitados (fail-open)", async () => {
    findMany.mockResolvedValue([]);
    const view = await getOrgModules("org-fail-open");
    expect(isModuleEnabled(view, MODULE.VENDAS)).toBe(true);
    expect(isModuleEnabled(view, MODULE.LOCACAO)).toBe(true);
  });

  it("features sem override resolvem o default do catálogo", async () => {
    findMany.mockResolvedValue([
      { module: "locacao", enabled: true, featureFlags: {} },
    ]);
    const view = await getOrgModules("org-defaults");
    // default true
    expect(isFeatureEnabled(view, FEATURE.LOCACAO_PIPELINE)).toBe(true);
    expect(isFeatureEnabled(view, FEATURE.LOCACAO_PESSOAS)).toBe(true);
    // default false
    expect(isFeatureEnabled(view, FEATURE.LOCACAO_COBRANCAS)).toBe(false);
    expect(isFeatureEnabled(view, FEATURE.LOCACAO_REPASSES)).toBe(false);
  });
});

describe("getOrgModules — overrides e cascata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("override liga uma feature que é false por default", async () => {
    findMany.mockResolvedValue([
      { module: "locacao", enabled: true, featureFlags: { "locacao.cobrancas": true } },
    ]);
    const view = await getOrgModules("org-override-on");
    expect(isFeatureEnabled(view, FEATURE.LOCACAO_COBRANCAS)).toBe(true);
  });

  it("módulo desabilitado força TODAS as features dele a false (ignora override)", async () => {
    findMany.mockResolvedValue([
      { module: "locacao", enabled: false, featureFlags: { "locacao.cobrancas": true } },
    ]);
    const view = await getOrgModules("org-module-off");
    expect(isModuleEnabled(view, MODULE.LOCACAO)).toBe(false);
    expect(isFeatureEnabled(view, FEATURE.LOCACAO_COBRANCAS)).toBe(false);
    expect(isFeatureEnabled(view, FEATURE.LOCACAO_PIPELINE)).toBe(false);
  });

  it("ignora chaves inválidas no featureFlags", async () => {
    findMany.mockResolvedValue([
      { module: "vendas", enabled: true, featureFlags: { "vendas.inexistente": true, naoboolean: "x" } },
    ]);
    const view = await getOrgModules("org-garbage");
    // não quebra; features válidas resolvem default
    expect(isFeatureEnabled(view, FEATURE.VENDAS_PIPELINE)).toBe(true);
  });
});

describe("guard — assert*Enabled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("assertModuleEnabled passa quando habilitado e lança quando off", async () => {
    findMany.mockResolvedValue([{ module: "locacao", enabled: true, featureFlags: {} }]);
    await expect(assertModuleEnabled("org-on", MODULE.LOCACAO)).resolves.toBeUndefined();

    findMany.mockResolvedValue([{ module: "locacao", enabled: false, featureFlags: {} }]);
    await expect(assertModuleEnabled("org-off", MODULE.LOCACAO)).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });

  it("assertFeatureEnabled lança com module preenchido no erro", async () => {
    findMany.mockResolvedValue([{ module: "locacao", enabled: true, featureFlags: {} }]);
    try {
      await assertFeatureEnabled("org-feat-off", FEATURE.LOCACAO_COBRANCAS);
      expect.unreachable("deveria ter lançado");
    } catch (e) {
      expect(e).toBeInstanceOf(ModuleDisabledError);
      expect((e as ModuleDisabledError).status).toBe(403);
      expect((e as ModuleDisabledError).code).toBe("MODULE_DISABLED");
      expect((e as ModuleDisabledError).module).toBe(MODULE.LOCACAO);
      expect((e as ModuleDisabledError).feature).toBe(FEATURE.LOCACAO_COBRANCAS);
    }
  });
});
