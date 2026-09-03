import { describe, it, expect } from "vitest";
import { basePathForTarget, esteiraForDealKind, TARGET_KIND_LABELS } from "../target-paths";
import { TARGET_KINDS } from "../types";

describe("basePathForTarget", () => {
  it.each([
    ["vendedor", 1, "venda", "vendedores.1"],
    ["comprador", 0, "venda", "compradores.0"],
    ["conjuge_vendedor", 2, "venda", "vendedores.2.conjuge"],
    ["procurador_vendedor", 0, "venda", "vendedores.0.procurador"],
    ["representante_vendedor", 0, "venda", "vendedores.0.representante"],
    ["diligenciado", 3, "venda", "diligenciados.3"],
    ["imovel", 1, "venda", "imoveis.1"],
    ["imovel", 0, "locacao", "imovel"],
    ["locatario", 1, "locacao", "locatarios.1"],
    ["locador", 0, "locacao", "locadores.0"],
    ["fiador", 0, "locacao", "garantia.fiador"],
    ["conjuge_fiador", 0, "locacao", "garantia.fiador.conjuge"],
  ] as const)("%s[%i] (%s) → %s", (kind, index, esteira, expected) => {
    expect(basePathForTarget(kind, index, esteira)).toBe(expected);
  });

  it("nunca devolve o fallback antigo `${kind}es.N` para alvos de locação", () => {
    // `locadores.0` coincide com o fallback por acaso; os outros três quebravam.
    for (const kind of ["locatario", "fiador", "conjuge_fiador"] as const) {
      expect(basePathForTarget(kind, 0)).not.toBe(`${kind}es.0`);
    }
  });

  it("cobre todos os TARGET_KINDS (label e path)", () => {
    for (const kind of TARGET_KINDS) {
      expect(typeof basePathForTarget(kind, 0)).toBe("string");
      expect(TARGET_KIND_LABELS[kind]).toBeTruthy();
    }
  });
});

describe("esteiraForDealKind", () => {
  it("só 'locacao' vira locação; o resto (venda, null, lixo) é venda", () => {
    expect(esteiraForDealKind("locacao")).toBe("locacao");
    expect(esteiraForDealKind("venda")).toBe("venda");
    expect(esteiraForDealKind(null)).toBe("venda");
    expect(esteiraForDealKind("administracao")).toBe("venda");
  });
});
