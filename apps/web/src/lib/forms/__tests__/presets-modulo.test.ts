import { describe, it, expect } from "vitest";
import {
  FORM_REQUIRED_PRESETS,
  LOCACAO_REQUIRED_PRESETS,
  isKnownLocacaoFormPath,
  legacyPresetToModuleKey,
  locacaoSettingsForForm,
  moduleFormSettings,
  resolveAllRequiredFields,
  resolveAllRequiredFieldsForModule,
  resolveRequiredFieldsForModule,
} from "../presets";
import { effectiveRequiredPaths, findMissingRequired } from "../party-required";
import { requiredPathsForRoleScope } from "../required-snapshot";

const TOTAL_STEPS = 7;

// Índices REAIS do wizard de locação (LOCACAO_STEP_LABELS).
const STEP_LOCADOR = 1;
const STEP_LOCATARIO = 2;
const STEP_IMOVEL = 3;
const STEP_ALUGUEL = 4;

describe("presets por módulo — shape", () => {
  it("locação tem os 3 níveis, cada um com 7 steps", () => {
    for (const preset of Object.values(LOCACAO_REQUIRED_PRESETS)) {
      expect(preset).toHaveLength(TOTAL_STEPS);
    }
    expect(LOCACAO_REQUIRED_PRESETS).toHaveProperty("legado");
    expect(LOCACAO_REQUIRED_PRESETS).toHaveProperty("essencial");
    expect(LOCACAO_REQUIRED_PRESETS).toHaveProperty("completo");
  });

  it("venda ganhou 'essencial' sem perder os legados", () => {
    for (const key of ["legado", "minimo", "padrao", "completo", "essencial"]) {
      expect(FORM_REQUIRED_PRESETS).toHaveProperty(key);
    }
  });

  it("todo path declarado nos presets de locação é um path conhecido", () => {
    for (const preset of Object.values(LOCACAO_REQUIRED_PRESETS)) {
      for (const step of preset) {
        for (const path of step) {
          expect(isKnownLocacaoFormPath(path), path).toBe(true);
        }
      }
    }
  });
});

describe("aliases legados de venda", () => {
  it("mapeiam pros níveis novos na LEITURA da UI", () => {
    expect(legacyPresetToModuleKey("legado")).toBe("essencial");
    expect(legacyPresetToModuleKey("minimo")).toBe("essencial");
    expect(legacyPresetToModuleKey("padrao")).toBe("completo");
    expect(legacyPresetToModuleKey("completo")).toBe("completo");
    expect(legacyPresetToModuleKey("custom")).toBe("custom");
    // Valor desconhecido/nulo cai no nível mais brando.
    expect(legacyPresetToModuleKey(null)).toBe("essencial");
    expect(legacyPresetToModuleKey("xyz")).toBe("essencial");
  });

  it("NÃO mudam a resolução: org em 'padrao' continua exigindo o de sempre", () => {
    // Se o alias valesse na resolução, `padrao` viraria `completo` e passaria a
    // exigir RG/nome da mãe/sexo da noite pro dia em toda org de produção.
    const padrao = resolveAllRequiredFieldsForModule("venda", {
      preset: "padrao",
      customRequiredPaths: [],
    });
    expect(padrao[1]).not.toContain("vendedores.0.rg");
    expect(padrao[1]).toContain("vendedores.0.estado_civil");
    expect(padrao).toEqual(
      resolveAllRequiredFields({ preset: "padrao", customRequiredPaths: [] }),
    );

    const legado = resolveAllRequiredFieldsForModule("venda", {
      preset: "legado",
      customRequiredPaths: [],
    });
    expect(legado[1]).toEqual(["vendedores"]);
  });

  it("venda 'essencial' exige identidade + contato + endereço básico", () => {
    const r = resolveRequiredFieldsForModule(
      "venda",
      { preset: "essencial", customRequiredPaths: [] },
      1,
    );
    expect(r).toEqual(
      expect.arrayContaining([
        "vendedores",
        "vendedores.0.cpf",
        "vendedores.0.email",
        "vendedores.0.mobile_phone",
        "vendedores.0.endereco",
      ]),
    );
    expect(r).not.toContain("vendedores.0.rg");
  });
});

describe("paths de locação", () => {
  const essencial = { preset: "essencial", customRequiredPaths: [] };
  const completo = { preset: "completo", customRequiredPaths: [] };

  it("essencial cobre a dor relatada: cpf e celular das duas partes", () => {
    const locador = resolveRequiredFieldsForModule("locacao", essencial, STEP_LOCADOR);
    const locatario = resolveRequiredFieldsForModule("locacao", essencial, STEP_LOCATARIO);
    for (const p of ["locadores.0.cpf", "locadores.0.mobile_phone", "locadores.0.email"]) {
      expect(locador).toContain(p);
    }
    for (const p of ["locatarios.0.cpf", "locatarios.0.mobile_phone", "locatarios.0.email"]) {
      expect(locatario).toContain(p);
    }
  });

  it("completo acrescenta data_nascimento e nacionalidade (além de cpf/celular)", () => {
    const locador = resolveRequiredFieldsForModule("locacao", completo, STEP_LOCADOR);
    for (const p of [
      "locadores.0.cpf",
      "locadores.0.mobile_phone",
      "locadores.0.data_nascimento",
      "locadores.0.nacionalidade",
      "locadores.0.rg",
      "locadores.0.estado_civil",
      "locadores.0.profissao",
    ]) {
      expect(locador).toContain(p);
    }
  });

  it("imóvel e aluguel usam os paths SINGULARES do schema de locação", () => {
    expect(resolveRequiredFieldsForModule("locacao", essencial, STEP_IMOVEL)).toEqual(
      expect.arrayContaining(["imovel.rua", "imovel.cidade", "imovel.descricao"]),
    );
    expect(resolveRequiredFieldsForModule("locacao", completo, STEP_IMOVEL)).toContain(
      "imovel.matricula",
    );
    expect(resolveRequiredFieldsForModule("locacao", essencial, STEP_ALUGUEL)).toEqual(
      expect.arrayContaining(["aluguel.valor", "aluguel.vigencia_inicio"]),
    );
  });

  it("etapa de garantia fica vazia nos dois níveis (fiador é condicional)", () => {
    expect(resolveRequiredFieldsForModule("locacao", essencial, 5)).toEqual([]);
    expect(resolveRequiredFieldsForModule("locacao", completo, 5)).toEqual([]);
  });

  it("custom fino soma ao nível escolhido", () => {
    const r = resolveRequiredFieldsForModule(
      "locacao",
      {
        preset: "essencial",
        customRequiredPaths: [{ step: STEP_IMOVEL, path: "imovel.matricula" }],
      },
      STEP_IMOVEL,
    );
    expect(r).toContain("imovel.matricula");
    expect(r).toContain("imovel.rua");
  });

  it("preset custom ignora a base e usa só a seleção fina", () => {
    const r = resolveRequiredFieldsForModule(
      "locacao",
      {
        preset: "custom",
        customRequiredPaths: [{ step: STEP_LOCADOR, path: "locadores.0.cpf" }],
      },
      STEP_LOCADOR,
    );
    expect(r).toEqual(["locadores.0.cpf"]);
  });

  it("isKnownLocacaoFormPath rejeita path órfão e aceita índice qualquer", () => {
    expect(isKnownLocacaoFormPath("locadores.2.cpf")).toBe(true);
    expect(isKnownLocacaoFormPath("garantia.fiador.cpf")).toBe(true);
    expect(isKnownLocacaoFormPath("locadores.0.nome_mae")).toBe(false);
    expect(isKnownLocacaoFormPath("imoveis.0.rua")).toBe(false); // plural é de venda
    expect(isKnownLocacaoFormPath("foo.bar")).toBe(false);
  });
});

describe("remap PF/PJ das partes de locação", () => {
  const reader = (values: Record<string, unknown>) => (path: string) =>
    path.split(".").reduce<unknown>(
      (acc, part) =>
        acc == null || typeof acc !== "object"
          ? undefined
          : (acc as Record<string, unknown>)[part],
      values,
    );

  it("PJ: cpf→cnpj, e-mail/celular vão pro representante, PF-only somem", () => {
    const values = {
      locadores: [{ tipo_pessoa: "juridica" }],
    };
    const out = effectiveRequiredPaths(
      [
        "locadores.0.cpf",
        "locadores.0.email",
        "locadores.0.mobile_phone",
        "locadores.0.rg",
        "locadores.0.estado_civil",
        "locadores.0.nacionalidade",
        "locadores.0.cidade",
      ],
      reader(values),
    );
    expect(out).toEqual([
      "locadores.0.cnpj",
      "locadores.0.representante.email",
      "locadores.0.representante.mobile_phone",
      "locadores.0.cidade",
    ]);
  });

  it("PF mantém os paths e expande pra TODAS as partes da lista", () => {
    const values = {
      locatarios: [{ tipo_pessoa: "fisica" }, { tipo_pessoa: "fisica" }],
    };
    const out = effectiveRequiredPaths(["locatarios.0.cpf"], reader(values));
    expect(out).toEqual(["locatarios.0.cpf", "locatarios.1.cpf"]);
  });

  it("findMissingRequired aponta o que falta na ficha de locação", () => {
    const values = {
      locatarios: [
        { tipo_pessoa: "fisica", cpf: "123", email: "", mobile_phone: "119" },
      ],
    };
    expect(
      findMissingRequired(
        ["locatarios.0.cpf", "locatarios.0.email", "locatarios.0.mobile_phone"],
        reader(values),
      ),
    ).toEqual(["locatarios.0.email"]);
  });
});

describe("retrocompat de formulários já abertos (snapshot)", () => {
  const row = {
    locacaoPreset: "completo",
    locacaoCustomRequiredPaths: [{ step: STEP_IMOVEL, path: "imovel.cartorio" }],
  };

  it("snapshot null → comportamento antigo (nada obrigatório)", () => {
    const settings = locacaoSettingsForForm(row, null);
    expect(settings).toBeNull();
    const all = resolveAllRequiredFieldsForModule("locacao", settings);
    expect(all.flat()).toEqual([]);
  });

  it("snapshot 'legado' → idem null", () => {
    expect(locacaoSettingsForForm(row, "legado")).toBeNull();
  });

  it("snapshot vence o preset ATUAL da org", () => {
    // Org já está em "completo", mas o form nasceu em "essencial".
    const settings = locacaoSettingsForForm(row, "essencial");
    const step = resolveRequiredFieldsForModule("locacao", settings, STEP_LOCADOR);
    expect(step).toContain("locadores.0.cpf");
    expect(step).not.toContain("locadores.0.rg"); // só existe no completo
  });

  it("custom paths da org continuam sendo lidos ao vivo por cima do snapshot", () => {
    const settings = locacaoSettingsForForm(row, "essencial");
    expect(
      resolveRequiredFieldsForModule("locacao", settings, STEP_IMOVEL),
    ).toContain("imovel.cartorio");
  });

  it("moduleFormSettings fatia a row por módulo e tolera row nula", () => {
    expect(moduleFormSettings(null, "locacao")).toBeNull();
    expect(
      moduleFormSettings({ preset: "padrao", locacaoPreset: "essencial" }, "venda"),
    ).toEqual({ preset: "padrao", customRequiredPaths: [] });
    expect(
      moduleFormSettings({ preset: "padrao", locacaoPreset: "essencial" }, "locacao"),
    ).toEqual({ preset: "essencial", customRequiredPaths: [] });
    // Org que nunca abriu a tela nova (colunas ausentes) → "legado".
    expect(moduleFormSettings({ preset: "padrao" }, "locacao")).toEqual({
      preset: "legado",
      customRequiredPaths: [],
    });
  });
});

describe("requiredPathsForRoleScope (link por parte)", () => {
  const byStep = resolveAllRequiredFieldsForModule("locacao", {
    preset: "essencial",
    customRequiredPaths: [],
  }).map((p) => Array.from(p));

  it("locatário só responde pelos próprios campos", () => {
    const scoped = requiredPathsForRoleScope(byStep, [0, 2], ["locatarios"]);
    expect(scoped).toContain("locatarios.0.cpf");
    expect(scoped.some((p) => p.startsWith("imovel"))).toBe(false);
    expect(scoped.some((p) => p.startsWith("locadores"))).toBe(false);
  });

  it("locador responde por si e pelo imóvel (ROLE_PATHS)", () => {
    const scoped = requiredPathsForRoleScope(byStep, [0, 1, 3], ["locadores", "imovel"]);
    expect(scoped).toContain("locadores.0.cpf");
    expect(scoped).toContain("imovel.rua");
    expect(scoped).toContain("imovel.descricao");
    // Aluguel (etapa 4) não está nos steps do locador.
    expect(scoped.some((p) => p.startsWith("aluguel"))).toBe(false);
  });

  it("fiador não herda exigência nenhuma (etapa de garantia vazia)", () => {
    expect(requiredPathsForRoleScope(byStep, [0, 5], ["garantia"])).toEqual([]);
  });
});
