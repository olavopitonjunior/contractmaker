import { describe, it, expect } from "vitest";
import {
  MODULE,
  FEATURE,
  MODULE_CATALOG,
  ALL_FEATURES,
  isValidModule,
  isValidFeature,
  featureModule,
  featureDefault,
  moduleDef,
} from "./catalog";

describe("catalog — integridade", () => {
  it("toda feature key tem prefixo do seu módulo", () => {
    for (const mod of MODULE_CATALOG) {
      for (const f of mod.features) {
        expect(f.key.startsWith(`${mod.key}.`)).toBe(true);
      }
    }
  });

  it("não há feature keys duplicadas", () => {
    const seen = new Set<string>();
    for (const f of ALL_FEATURES) {
      expect(seen.has(f)).toBe(false);
      seen.add(f);
    }
  });

  it("cobre os dois módulos esperados", () => {
    const keys = MODULE_CATALOG.map((m) => m.key).sort();
    expect(keys).toEqual([MODULE.LOCACAO, MODULE.VENDAS].sort());
  });
});

describe("isValidModule / isValidFeature", () => {
  it("aceita chaves conhecidas e rejeita desconhecidas", () => {
    expect(isValidModule("vendas")).toBe(true);
    expect(isValidModule("locacao")).toBe(true);
    expect(isValidModule("financeiro")).toBe(false);
    expect(isValidModule("")).toBe(false);

    expect(isValidFeature(FEATURE.LOCACAO_COBRANCAS)).toBe(true);
    expect(isValidFeature("locacao.inexistente")).toBe(false);
  });
});

describe("featureModule", () => {
  it("resolve o módulo de cada feature", () => {
    expect(featureModule(FEATURE.VENDAS_CERTIDOES)).toBe(MODULE.VENDAS);
    expect(featureModule(FEATURE.LOCACAO_REPASSES)).toBe(MODULE.LOCACAO);
  });

  it("lança para feature fora do catálogo", () => {
    expect(() => featureModule("x.y" as never)).toThrow();
  });
});

describe("featureDefault", () => {
  it("retorna o default declarado no catálogo", () => {
    expect(featureDefault(FEATURE.VENDAS_PIPELINE)).toBe(true);
    expect(featureDefault(FEATURE.LOCACAO_COBRANCAS)).toBe(false);
    expect(featureDefault(FEATURE.LOCACAO_PESSOAS)).toBe(true);
  });

  it("é false para feature desconhecida (fail-safe)", () => {
    expect(featureDefault("x.y" as never)).toBe(false);
  });
});

describe("moduleDef", () => {
  it("retorna a definição completa", () => {
    expect(moduleDef(MODULE.LOCACAO).label).toBe("Locação");
    expect(moduleDef(MODULE.VENDAS).features.length).toBeGreaterThan(0);
  });
});
