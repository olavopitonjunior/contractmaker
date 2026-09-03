import { describe, it, expect } from "vitest";
import {
  ALL_GROUPS,
  defaultGroupsFor,
  emptyByGroup,
  groupForJob,
  initialOpenSections,
  KIND_LABEL,
  sectionsFor,
} from "../certidoes-groups";
import { TARGET_KINDS } from "@/lib/certidoes/types";

describe("groupForJob", () => {
  it.each([
    ["vendedor", undefined, "vendedores"],
    ["conjuge_vendedor", "padrao", "vendedores"],
    ["procurador_vendedor", "padrao", "vendedores"],
    ["representante_vendedor", "padrao", "vendedores"],
    ["comprador", "opcional", "compradores"],
    ["diligenciado", "padrao", "adicionais"],
    ["imovel", "imovel", "imovel"],
    ["vendedor", "pesquisa", "pesquisa"],
    ["locatario", "padrao", "locatarios"],
    ["fiador", "padrao", "fiador"],
    ["conjuge_fiador", "padrao", "fiador"],
    ["fiador", "pesquisa", "pesquisa"],
    ["locador", "opcional", "locadores"],
  ] as const)("%s (tier %s) → %s", (targetKind, tier, expected) => {
    expect(groupForJob({ targetKind, tier: tier as never })).toBe(expected);
  });
});

describe("defaults e seções por esteira", () => {
  it("venda: vendedores + adicionais pré-marcados; locação: locatários + fiador + adicionais", () => {
    expect([...defaultGroupsFor("venda")].sort()).toEqual(["adicionais", "vendedores"]);
    expect([...defaultGroupsFor("locacao")].sort()).toEqual(["adicionais", "fiador", "locatarios"]);
  });

  it("seções de locação não mostram vendedores/compradores e vice-versa", () => {
    const loc = sectionsFor("locacao").map((s) => s.group);
    expect(loc).toEqual(["locatarios", "fiador", "adicionais", "locadores", "imovel", "pesquisa"]);
    const venda = sectionsFor("venda").map((s) => s.group);
    expect(venda).toEqual(["vendedores", "adicionais", "compradores", "imovel", "pesquisa"]);
  });

  it("seções abertas = pré-marcadas; todos os grupos têm entrada", () => {
    const open = initialOpenSections("locacao");
    expect(Object.keys(open).sort()).toEqual([...ALL_GROUPS].sort());
    expect(open).toEqual({
      vendedores: false,
      adicionais: true,
      compradores: false,
      locatarios: true,
      fiador: true,
      locadores: false,
      imovel: false,
      pesquisa: false,
    });
    expect(Object.keys(emptyByGroup()).sort()).toEqual([...ALL_GROUPS].sort());
  });

  it("todo TargetKind tem rótulo", () => {
    for (const k of TARGET_KINDS) expect(KIND_LABEL[k]).toBeTruthy();
    expect(KIND_LABEL.conjuge_fiador).toBe("Cônjuge do fiador");
  });
});
