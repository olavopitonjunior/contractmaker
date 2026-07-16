import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONTRACT_SETTINGS,
  contractSettingsSchema,
  resolveOrgContractDefaults,
  extractContractSettings,
  buildSettingsPatch,
} from "@/lib/contracts/default-config";

describe("resolveOrgContractDefaults", () => {
  it("org sem preferência cai no padrão de fábrica", () => {
    expect(resolveOrgContractDefaults({})).toEqual(DEFAULT_CONTRACT_SETTINGS);
    expect(resolveOrgContractDefaults(null)).toEqual(DEFAULT_CONTRACT_SETTINGS);
    expect(resolveOrgContractDefaults(undefined)).toEqual(DEFAULT_CONTRACT_SETTINGS);
  });

  it("aplica só o que a org definiu, mantendo o resto do padrão", () => {
    const out = resolveOrgContractDefaults({
      venda: { foro: "justica-publica", config: { multa_penal_moratoria: 5 } },
    });
    expect(out.foro).toBe("justica-publica");
    expect(out.config.multa_penal_moratoria).toBe(5);
    expect(out.config.atualizacao_monetaria).toBe("IPCA/IBGE");
    expect(out.desistencia).toEqual(DEFAULT_CONTRACT_SETTINGS.desistencia);
  });

  it("Json inválido no banco não derruba a geração", () => {
    // A coluna é Json livre — nada garante o shape.
    const out = resolveOrgContractDefaults({
      venda: {
        foro: "tribunal-marciano",
        config: { multa_penal_moratoria: "muito", juros_mensais_atraso: null },
        desistencia: { permite: "talvez" },
      },
    });
    expect(out.foro).toBe("arbitragem");
    expect(out.config.multa_penal_moratoria).toBe(2);
    expect(out.config.juros_mensais_atraso).toBe(1);
    expect(out.desistencia.permite).toBe(false);
  });

  it("ignora o namespace de locação (semântica de foro é outra)", () => {
    const out = resolveOrgContractDefaults({
      locacao: { foro: "São Paulo/SP" },
    });
    expect(out.foro).toBe("arbitragem");
  });

  it("desistencia.permite=false explícito é respeitado, não confundido com ausente", () => {
    const out = resolveOrgContractDefaults({
      venda: { desistencia: { permite: false } },
    });
    expect(out.desistencia.permite).toBe(false);
  });
});

describe("extractContractSettings", () => {
  it("lê o que o contrato tem e completa com o padrão", () => {
    const out = extractContractSettings({
      foro: "justica-publica",
      config: { multa_penal_moratoria: 7 },
    });
    expect(out.foro).toBe("justica-publica");
    expect(out.config.multa_penal_moratoria).toBe(7);
    // Não gravado → padrão (= o prazo que a cláusula já praticava).
    expect(out.config.prazo_atraso_rescisao).toBe(15);
  });

  it("usa o padrão da ORG como piso quando informado", () => {
    const orgDefaults = {
      ...DEFAULT_CONTRACT_SETTINGS,
      config: { ...DEFAULT_CONTRACT_SETTINGS.config, atualizacao_monetaria: "IGP-M" },
    };
    const out = extractContractSettings({}, orgDefaults);
    expect(out.config.atualizacao_monetaria).toBe("IGP-M");
  });
});

describe("buildSettingsPatch", () => {
  it("grava as pontes config.* que o enrich materializa", () => {
    // Sem isto, mudar assinatura/desistência não mexeria no texto: o
    // Contract.dataJson já está enriquecido e o enrich não sobrescreve.
    const patch = buildSettingsPatch({
      ...DEFAULT_CONTRACT_SETTINGS,
      desistencia: { permite: true, prazo_dias: 15 },
      assinatura: { cidade: "Santos", uf: "SP", data: "2026-08-01" },
    });
    const config = patch.config as Record<string, unknown>;
    expect(config.desistencia_permite).toBe(true);
    expect(config.desistencia_prazo_dias).toBe(15);
    expect(config.municipio_imovel).toBe("Santos/SP");
    expect(config.data_assinatura).toBe("2026-08-01");
  });

  it("toggle-off grava false explícito (deepMergeAtPaths ignora null)", () => {
    const patch = buildSettingsPatch({
      ...DEFAULT_CONTRACT_SETTINGS,
      desistencia: { permite: false, prazo_dias: 7 },
    });
    const config = patch.config as Record<string, unknown>;
    expect(config.desistencia_permite).toBe(false);
    // Prazo não vai quando a cláusula está desligada.
    expect(config.desistencia_prazo_dias).toBeUndefined();
  });

  it("cidade vazia não sobrescreve o município do imóvel", () => {
    const patch = buildSettingsPatch(DEFAULT_CONTRACT_SETTINGS);
    const config = patch.config as Record<string, unknown>;
    expect(config.municipio_imovel).toBeUndefined();
    expect(config.data_assinatura).toBeUndefined();
  });

  it("foro vai top-level — os templates v2 leem `foro`, não `config.foro`", () => {
    const patch = buildSettingsPatch({
      ...DEFAULT_CONTRACT_SETTINGS,
      foro: "justica-publica",
    });
    expect(patch.foro).toBe("justica-publica");
  });
});

describe("contractSettingsSchema", () => {
  it("rejeita foro fora do enum", () => {
    const r = contractSettingsSchema.safeParse({
      ...DEFAULT_CONTRACT_SETTINGS,
      foro: "qualquer",
    });
    expect(r.success).toBe(false);
  });

  it("rejeita data em formato não-ISO", () => {
    const r = contractSettingsSchema.safeParse({
      ...DEFAULT_CONTRACT_SETTINGS,
      assinatura: { cidade: "SP", uf: "SP", data: "01/08/2026" },
    });
    expect(r.success).toBe(false);
  });

  it("aceita data vazia (= assinar na data corrente)", () => {
    const r = contractSettingsSchema.safeParse(DEFAULT_CONTRACT_SETTINGS);
    expect(r.success).toBe(true);
  });
});
