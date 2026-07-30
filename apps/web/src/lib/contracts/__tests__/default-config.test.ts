import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONTRACT_SETTINGS,
  DEFAULT_LOCACAO_SETTINGS,
  contractSettingsSchema,
  locacaoSettingsSchema,
  resolveOrgContractDefaults,
  resolveOrgVendaDefaults,
  resolveOrgLocacaoDefaults,
  extractContractSettings,
  extractLocacaoSettings,
  buildSettingsPatch,
  buildLocacaoSettingsPatch,
  foreignSettingsFields,
  resolveSettingsFamily,
} from "@/lib/contracts/default-config";

describe("resolveOrgContractDefaults", () => {
  it("devolve os dois branches, cada um no seu padrão de fábrica", () => {
    for (const input of [{}, null, undefined]) {
      expect(resolveOrgContractDefaults(input)).toEqual({
        venda: DEFAULT_CONTRACT_SETTINGS,
        locacao: DEFAULT_LOCACAO_SETTINGS,
      });
    }
  });

  it("os branches são independentes — mexer em um não move o outro", () => {
    const out = resolveOrgContractDefaults({
      venda: { foro: "justica-publica" },
      locacao: { config: { multa_atraso_percent: 2 } },
    });
    expect(out.venda.foro).toBe("justica-publica");
    expect(out.venda.config).toEqual(DEFAULT_CONTRACT_SETTINGS.config);
    expect(out.locacao.config.multa_atraso_percent).toBe(2);
    expect(out.locacao.config.multa_rescisoria_meses).toBe(3);
    expect(out.locacao.foro).toBe("");
  });
});

describe("resolveOrgVendaDefaults", () => {
  it("org sem preferência cai no padrão de fábrica", () => {
    expect(resolveOrgVendaDefaults({})).toEqual(DEFAULT_CONTRACT_SETTINGS);
    expect(resolveOrgVendaDefaults(null)).toEqual(DEFAULT_CONTRACT_SETTINGS);
    expect(resolveOrgVendaDefaults(undefined)).toEqual(DEFAULT_CONTRACT_SETTINGS);
  });

  it("aplica só o que a org definiu, mantendo o resto do padrão", () => {
    const out = resolveOrgVendaDefaults({
      venda: { foro: "justica-publica", config: { multa_penal_moratoria: 5 } },
    });
    expect(out.foro).toBe("justica-publica");
    expect(out.config.multa_penal_moratoria).toBe(5);
    expect(out.config.atualizacao_monetaria).toBe("IPCA/IBGE");
    expect(out.desistencia).toEqual(DEFAULT_CONTRACT_SETTINGS.desistencia);
  });

  it("Json inválido no banco não derruba a geração", () => {
    // A coluna é Json livre — nada garante o shape.
    const out = resolveOrgVendaDefaults({
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
    const out = resolveOrgVendaDefaults({
      locacao: { foro: "São Paulo/SP" },
    });
    expect(out.foro).toBe("arbitragem");
  });

  it("desistencia.permite=false explícito é respeitado, não confundido com ausente", () => {
    const out = resolveOrgVendaDefaults({
      venda: { desistencia: { permite: false } },
    });
    expect(out.desistencia.permite).toBe(false);
  });
});

describe("resolveOrgLocacaoDefaults", () => {
  it("sem preferência cai nos números que o enrich praticava hard-coded", () => {
    expect(resolveOrgLocacaoDefaults({})).toEqual(DEFAULT_LOCACAO_SETTINGS);
    expect(resolveOrgLocacaoDefaults(null).config).toEqual({
      multa_atraso_percent: 10,
      juros_mensais_atraso: 1,
      multa_rescisoria_meses: 3,
    });
  });

  it("comarca é texto livre (não enum) e sobrepõe o padrão", () => {
    const out = resolveOrgLocacaoDefaults({ locacao: { foro: "Santos/SP" } });
    expect(out.foro).toBe("Santos/SP");
  });

  it("ignora o namespace de venda", () => {
    const out = resolveOrgLocacaoDefaults({
      venda: { foro: "arbitragem", config: { multa_penal_moratoria: 9 } },
    });
    expect(out).toEqual(DEFAULT_LOCACAO_SETTINGS);
  });

  it("Json inválido cai no padrão em vez de virar zero silencioso", () => {
    const out = resolveOrgLocacaoDefaults({
      locacao: { config: { multa_atraso_percent: null, juros_mensais_atraso: "x" } },
    });
    expect(out.config.multa_atraso_percent).toBe(10);
    expect(out.config.juros_mensais_atraso).toBe(1);
  });
});

describe("resolveSettingsFamily", () => {
  it("pipeline de locação e contrato de administração são família locação", () => {
    expect(resolveSettingsFamily({ pipelineKind: "locacao" })).toBe("locacao");
    expect(
      resolveSettingsFamily({ contractKind: "administracao", pipelineKind: "locacao" })
    ).toBe("locacao");
    // ADM sempre é locação, mesmo se o pipeline vier ausente/errado.
    expect(resolveSettingsFamily({ contractKind: "administracao" })).toBe("locacao");
  });

  it("venda é o default (inclusive sem pipeline conhecido)", () => {
    expect(resolveSettingsFamily({ pipelineKind: "venda" })).toBe("venda");
    expect(resolveSettingsFamily({ contractKind: "contract" })).toBe("venda");
    expect(resolveSettingsFamily({})).toBe("venda");
  });
});

describe("foreignSettingsFields", () => {
  it("acusa payload de venda mandado num contrato de locação", () => {
    const found = foreignSettingsFields("locacao", DEFAULT_CONTRACT_SETTINGS);
    expect(found).toContain("desistencia");
    expect(found).toContain("config.multa_penal_moratoria");
    expect(found).toContain("config.prazo_multa_rescisoria");
  });

  it("acusa payload de locação mandado num contrato de venda", () => {
    const found = foreignSettingsFields("venda", DEFAULT_LOCACAO_SETTINGS);
    expect(found).toEqual([
      "config.multa_atraso_percent",
      "config.multa_rescisoria_meses",
    ]);
  });

  it("payload da própria família não acusa nada", () => {
    expect(foreignSettingsFields("venda", DEFAULT_CONTRACT_SETTINGS)).toEqual([]);
    expect(foreignSettingsFields("locacao", DEFAULT_LOCACAO_SETTINGS)).toEqual([]);
    expect(foreignSettingsFields("locacao", null)).toEqual([]);
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

describe("extractLocacaoSettings", () => {
  it("lê a comarca do top-level e completa o resto com o padrão", () => {
    const out = extractLocacaoSettings({
      foro: "Campinas/SP",
      config: { multa_atraso_percent: 5 },
    });
    expect(out.foro).toBe("Campinas/SP");
    expect(out.config.multa_atraso_percent).toBe(5);
    expect(out.config.multa_rescisoria_meses).toBe(3);
  });

  it("cai em config.foro_texto — a ponte que o template imprime", () => {
    const out = extractLocacaoSettings({ config: { foro_texto: "Santos/SP" } });
    expect(out.foro).toBe("Santos/SP");
  });

  it("usa o padrão da ORG como piso", () => {
    const org = {
      ...DEFAULT_LOCACAO_SETTINGS,
      config: { ...DEFAULT_LOCACAO_SETTINGS.config, multa_atraso_percent: 2 },
    };
    expect(extractLocacaoSettings({}, org).config.multa_atraso_percent).toBe(2);
  });
});

describe("buildLocacaoSettingsPatch", () => {
  it("grava a ponte config.foro_texto e o município do fecho", () => {
    const patch = buildLocacaoSettingsPatch({
      foro: "Santos/SP",
      assinatura: { cidade: "Santos", uf: "SP", data: "2026-08-01" },
      config: {
        multa_atraso_percent: 8,
        juros_mensais_atraso: 1,
        multa_rescisoria_meses: 3,
      },
    });
    const config = patch.config as Record<string, unknown>;
    expect(patch.foro).toBe("Santos/SP");
    expect(config.foro_texto).toBe("Santos/SP");
    expect(config.multa_atraso_percent).toBe(8);
    expect(config.municipio_imovel).toBe("Santos/SP");
    expect(config.data_assinatura).toBe("2026-08-01");
    // Nada do vocabulário de venda vaza pro dataJson de locação.
    expect(config.desistencia_permite).toBeUndefined();
    expect(config.multa_penal_moratoria).toBeUndefined();
  });

  it("comarca apagada grava foro_texto vazio (volta ao fallback do template)", () => {
    const patch = buildLocacaoSettingsPatch(DEFAULT_LOCACAO_SETTINGS);
    const config = patch.config as Record<string, unknown>;
    expect(config.foro_texto).toBe("");
    expect(config.municipio_imovel).toBeUndefined();
    expect(config.data_assinatura).toBeUndefined();
  });
});

describe("locacaoSettingsSchema", () => {
  it("aceita o padrão de fábrica (comarca vazia inclusive)", () => {
    expect(locacaoSettingsSchema.safeParse(DEFAULT_LOCACAO_SETTINGS).success).toBe(
      true
    );
  });

  it("rejeita campos de venda em vez de descartá-los em silêncio", () => {
    const r = locacaoSettingsSchema.safeParse(DEFAULT_CONTRACT_SETTINGS);
    expect(r.success).toBe(false);
  });

  it("rejeita data em formato não-ISO", () => {
    const r = locacaoSettingsSchema.safeParse({
      ...DEFAULT_LOCACAO_SETTINGS,
      assinatura: { cidade: "SP", uf: "SP", data: "01/08/2026" },
    });
    expect(r.success).toBe(false);
  });
});
