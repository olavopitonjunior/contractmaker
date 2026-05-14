import { describe, it, expect } from "vitest";
import { ROLE_PATHS, filterDataJsonByRole } from "../role-paths";

const FULL_DATA = {
  vendedores: [{ nome: "João", cpf: "111" }],
  compradores: [{ nome: "Maria", cpf: "222" }],
  imoveis: [{ rua: "Augusta", numero: "500" }],
  pagamento: { valor_total: 100000 },
  comissao: { valor: 5000 },
  config: { multa_penal_moratoria: 2 },
  assinatura: { cidade: "SP" },
  testemunhas: [{ nome: "T1" }],
};

describe("ROLE_PATHS shape", () => {
  it("vendedor inclui vendedores + imoveis", () => {
    expect(ROLE_PATHS.vendedor).toContain("vendedores");
    expect(ROLE_PATHS.vendedor).toContain("imoveis");
  });

  it("vendedor NÃO inclui compradores nem campos comerciais", () => {
    expect(ROLE_PATHS.vendedor).not.toContain("compradores");
    expect(ROLE_PATHS.vendedor).not.toContain("pagamento");
    expect(ROLE_PATHS.vendedor).not.toContain("comissao");
  });

  it("comprador só inclui compradores", () => {
    expect(ROLE_PATHS.comprador).toEqual(["compradores"]);
  });
});

describe("filterDataJsonByRole", () => {
  it("vendedor: mantém vendedores + imoveis, remove tudo o resto", () => {
    const r = filterDataJsonByRole(FULL_DATA, "vendedor");
    expect(r).toEqual({
      vendedores: [{ nome: "João", cpf: "111" }],
      imoveis: [{ rua: "Augusta", numero: "500" }],
    });
    expect(r).not.toHaveProperty("compradores");
    expect(r).not.toHaveProperty("pagamento");
    expect(r).not.toHaveProperty("comissao");
    expect(r).not.toHaveProperty("config");
    expect(r).not.toHaveProperty("assinatura");
    expect(r).not.toHaveProperty("testemunhas");
  });

  it("comprador: mantém só compradores", () => {
    const r = filterDataJsonByRole(FULL_DATA, "comprador");
    expect(r).toEqual({
      compradores: [{ nome: "Maria", cpf: "222" }],
    });
    expect(r).not.toHaveProperty("vendedores");
    expect(r).not.toHaveProperty("imoveis");
  });

  it("dataJson vazio → {}", () => {
    expect(filterDataJsonByRole({}, "vendedor")).toEqual({});
    expect(filterDataJsonByRole({}, "comprador")).toEqual({});
  });

  it("não muta o input", () => {
    const original = JSON.parse(JSON.stringify(FULL_DATA));
    filterDataJsonByRole(FULL_DATA, "vendedor");
    expect(FULL_DATA).toEqual(original);
  });

  it("chaves desconhecidas são descartadas (allowlist enforced)", () => {
    const withExtra = { ...FULL_DATA, foo: "bar", hackerField: 42 };
    const r = filterDataJsonByRole(withExtra, "vendedor");
    expect(r).not.toHaveProperty("foo");
    expect(r).not.toHaveProperty("hackerField");
  });

  it("preserva referência interna (não clona profundo desnecessariamente)", () => {
    const r = filterDataJsonByRole(FULL_DATA, "vendedor");
    // O array mantém a mesma referência (filter é shallow)
    expect(r.vendedores).toBe(FULL_DATA.vendedores);
  });
});
