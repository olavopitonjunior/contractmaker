import { describe, it, expect } from "vitest";
import {
  FORM_REQUIRED_PRESETS,
  resolveRequiredFields,
  resolveAllRequiredFields,
} from "../presets";

const TOTAL_STEPS = 8;

describe("resolveRequiredFields", () => {
  describe("settings null/undefined → fallback legado", () => {
    it("null usa preset legado", () => {
      // Legado tem ["vendedores"] no step 1 — mesmo array de antes de OrgFormSettings.
      const r = resolveRequiredFields(null, 1);
      expect(r).toEqual(["vendedores"]);
    });

    it("step fora do range retorna array vazio", () => {
      expect(resolveRequiredFields(null, -1)).toEqual([]);
      expect(resolveRequiredFields(null, 99)).toEqual([]);
      expect(resolveRequiredFields(null, TOTAL_STEPS)).toEqual([]);
    });
  });

  describe("preset padrão", () => {
    const s = { preset: "padrao", customRequiredPaths: [] };

    it("step 1 inclui cpf + estado_civil + endereço do vendedor", () => {
      const r = resolveRequiredFields(s, 1);
      expect(r).toContain("vendedores");
      expect(r).toContain("vendedores.0.cpf");
      expect(r).toContain("vendedores.0.estado_civil");
      expect(r).toContain("vendedores.0.endereco");
    });

    it("step 2 inclui cpf + estado_civil do comprador", () => {
      const r = resolveRequiredFields(s, 2);
      expect(r).toContain("compradores");
      expect(r).toContain("compradores.0.cpf");
      expect(r).toContain("compradores.0.estado_civil");
    });

    it("step 5 mantém pagamento.valor_total como no legado", () => {
      expect(resolveRequiredFields(s, 5)).toEqual(["pagamento.valor_total"]);
    });
  });

  describe("preset completo", () => {
    const s = { preset: "completo", customRequiredPaths: [] };

    it("step 1 inclui RG, data_nascimento, nome_mae do vendedor (campos TJSP/PGFN)", () => {
      const r = resolveRequiredFields(s, 1);
      expect(r).toContain("vendedores.0.rg");
      expect(r).toContain("vendedores.0.data_nascimento");
      expect(r).toContain("vendedores.0.nome_mae");
    });

    it("step 3 inclui matricula do imóvel", () => {
      expect(resolveRequiredFields(s, 3)).toContain("imoveis.0.matricula");
    });
  });

  describe("preset minimo", () => {
    const s = { preset: "minimo", customRequiredPaths: [] };

    it("step 3 só exige descricao do imóvel (sem rua/cidade/uf)", () => {
      expect(resolveRequiredFields(s, 3)).toEqual(["imoveis.0.descricao"]);
    });
  });

  describe("customRequiredPaths override fino", () => {
    it("preset padrao + custom une os arrays (union sem duplicatas)", () => {
      const s = {
        preset: "padrao",
        customRequiredPaths: [
          { step: 1, path: "vendedores.0.rg" }, // não está no padrao
          { step: 1, path: "vendedores.0.cpf" }, // já está, não duplicar
        ],
      };
      const r = resolveRequiredFields(s, 1);
      expect(r).toContain("vendedores.0.rg");
      expect(r).toContain("vendedores.0.cpf");
      // Sem duplicatas
      const dedupCount = r.filter((p) => p === "vendedores.0.cpf").length;
      expect(dedupCount).toBe(1);
    });

    it("custom paths de step diferente não vazam pra step atual", () => {
      const s = {
        preset: "padrao",
        customRequiredPaths: [
          { step: 5, path: "pagamento.sinal_arras" }, // step 5, não step 1
        ],
      };
      const r1 = resolveRequiredFields(s, 1);
      expect(r1).not.toContain("pagamento.sinal_arras");
      const r5 = resolveRequiredFields(s, 5);
      expect(r5).toContain("pagamento.sinal_arras");
    });
  });

  describe("preset custom (sem base)", () => {
    it("usa só customRequiredPaths, ignora qualquer preset implícito", () => {
      const s = {
        preset: "custom",
        customRequiredPaths: [
          { step: 1, path: "vendedores.0.rg" },
        ],
      };
      // Step 1 com base "legado" teria ["vendedores"] — mas custom não soma base.
      const r = resolveRequiredFields(s, 1);
      expect(r).toEqual(["vendedores.0.rg"]);
    });

    it("custom com array vazio retorna []", () => {
      const s = { preset: "custom", customRequiredPaths: [] };
      expect(resolveRequiredFields(s, 1)).toEqual([]);
    });
  });

  describe("customRequiredPaths malformado é ignorado silenciosamente", () => {
    it("string em vez de array → cai no preset base", () => {
      const s = { preset: "padrao", customRequiredPaths: "not-an-array" };
      const r = resolveRequiredFields(s, 1);
      // Volta pro padrao base, sem crashar
      expect(r).toContain("vendedores");
      expect(r).toContain("vendedores.0.cpf");
    });

    it("items sem step ou path → filtrados", () => {
      const s = {
        preset: "padrao",
        customRequiredPaths: [
          { path: "vendedores.0.rg" }, // sem step
          { step: 1 }, // sem path
          { step: "1", path: "vendedores.0.rg" }, // step não é number
          { step: 1, path: 123 }, // path não é string
        ],
      };
      const r = resolveRequiredFields(s, 1);
      // Nenhum dos items malformados aparece
      expect(r).not.toContain("vendedores.0.rg");
    });

    it("null em customRequiredPaths → ignorado", () => {
      const s = { preset: "padrao", customRequiredPaths: null };
      const r = resolveRequiredFields(s, 1);
      expect(r).toContain("vendedores");
    });
  });
});

describe("resolveAllRequiredFields", () => {
  it("retorna array de exatamente 8 elementos", () => {
    const all = resolveAllRequiredFields(null);
    expect(all).toHaveLength(TOTAL_STEPS);
  });

  it("cada elemento é um array readonly", () => {
    const all = resolveAllRequiredFields({
      preset: "padrao",
      customRequiredPaths: [],
    });
    for (const step of all) {
      expect(Array.isArray(step)).toBe(true);
    }
  });

  it("reflete preset completo em todos os steps relevantes", () => {
    const all = resolveAllRequiredFields({
      preset: "completo",
      customRequiredPaths: [],
    });
    expect(all[1]).toContain("vendedores.0.rg");
    expect(all[2]).toContain("compradores.0.rg");
    expect(all[3]).toContain("imoveis.0.matricula");
    expect(all[5]).toContain("pagamento.valor_total");
  });
});

describe("FORM_REQUIRED_PRESETS shape", () => {
  it("tem todas as 4 chaves não-custom", () => {
    expect(FORM_REQUIRED_PRESETS).toHaveProperty("legado");
    expect(FORM_REQUIRED_PRESETS).toHaveProperty("minimo");
    expect(FORM_REQUIRED_PRESETS).toHaveProperty("padrao");
    expect(FORM_REQUIRED_PRESETS).toHaveProperty("completo");
  });

  it("cada preset tem array de 8 steps", () => {
    for (const preset of Object.values(FORM_REQUIRED_PRESETS)) {
      expect(preset).toHaveLength(TOTAL_STEPS);
    }
  });
});
