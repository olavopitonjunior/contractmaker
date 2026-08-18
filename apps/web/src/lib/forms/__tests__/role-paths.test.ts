import { describe, it, expect } from "vitest";
import {
  ROLE_PATHS,
  filterDataJsonByRole,
  filterDataJsonByPaths,
  narrowIncomingToPaths,
  resolveRolePaths,
  topKeysOfPaths,
} from "../role-paths";
import { ROLE_STEP_INDEXES, resolveRoleSteps } from "../role-steps";
import type { ParticipantRole } from "../participant-token";

const BUILT_INS: ParticipantRole[] = [
  "vendedor",
  "comprador",
  "locador",
  "locatario",
  "fiador",
];

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

  it("comprador inclui compradores + pagamento (default 2026-08)", () => {
    expect(ROLE_PATHS.comprador).toEqual([
      "compradores",
      "modalidade",
      "pagamento",
      "incluso_no_preco",
    ]);
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

  it("comprador: mantém compradores (+ pagamento quando houver), nunca vendedores", () => {
    const r = filterDataJsonByRole(FULL_DATA, "comprador");
    expect(r.compradores).toEqual([{ nome: "Maria", cpf: "222" }]);
    expect(r).not.toHaveProperty("vendedores");
    expect(r).not.toHaveProperty("imoveis");
    expect(r).not.toHaveProperty("comissao");
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

// ---------------------------------------------------------------------------
// Regressão dos 5 papéis NATIVOS: a resolução por função tem que devolver
// exatamente os mapas antigos. Qualquer divergência aqui é mudança de
// comportamento em link já em circulação.
// ---------------------------------------------------------------------------
describe("resolveRolePaths / resolveRoleSteps — regressão dos nativos", () => {
  it.each(BUILT_INS)("%s: paths idênticos a ROLE_PATHS", (role) => {
    expect(resolveRolePaths(role)).toEqual(ROLE_PATHS[role]);
    // Mesma referência: nada é reconstruído no caminho dos nativos.
    expect(resolveRolePaths(role)).toBe(ROLE_PATHS[role]);
  });

  it.each(BUILT_INS)("%s: steps idênticos a ROLE_STEP_INDEXES", (role) => {
    expect(resolveRoleSteps(role)).toEqual(ROLE_STEP_INDEXES[role]);
    expect(resolveRoleSteps(role)).toBe(ROLE_STEP_INDEXES[role]);
  });

  it.each(BUILT_INS)("%s: filtro por paths == filtro por role", (role) => {
    expect(filterDataJsonByPaths(FULL_DATA, resolveRolePaths(role))).toEqual(
      filterDataJsonByRole(FULL_DATA, role),
    );
  });

  it.each(BUILT_INS)("%s: escopo é raso (nenhum path com ponto)", (role) => {
    expect(resolveRolePaths(role).some((p) => p.includes("."))).toBe(false);
    expect(topKeysOfPaths(resolveRolePaths(role))).toEqual([
      ...ROLE_PATHS[role],
    ]);
  });

  it("role desconhecido falha fechado (sem escopo, sem step)", () => {
    expect(resolveRolePaths("hacker")).toEqual([]);
    expect(resolveRoleSteps("hacker")).toEqual([]);
    expect(resolveRolePaths("terceiro:BAD SLUG")).toEqual([]);
  });
});

describe("escopo de TERCEIRO", () => {
  const DATA_COM_TERCEIROS = {
    ...FULL_DATA,
    terceiros: {
      "interveniente-anuente": [{ nome: "Anuente", cpf: "333" }],
      sindico: [{ nome: "Síndico", email: "s@x.com" }],
    },
  };

  it("role vira o path da própria subárvore", () => {
    expect(resolveRolePaths("terceiro:sindico")).toEqual(["terceiros.sindico"]);
    expect(resolveRoleSteps("terceiro:sindico")).toEqual([]);
  });

  it("filtro expõe SÓ a própria categoria — nada de outra nem do negócio", () => {
    const r = filterDataJsonByPaths(
      DATA_COM_TERCEIROS,
      resolveRolePaths("terceiro:sindico"),
    );
    expect(r).toEqual({
      terceiros: { sindico: [{ nome: "Síndico", email: "s@x.com" }] },
    });
    expect(
      (r.terceiros as Record<string, unknown>)["interveniente-anuente"],
    ).toBeUndefined();
    expect(r).not.toHaveProperty("vendedores");
    expect(r).not.toHaveProperty("compradores");
    expect(r).not.toHaveProperty("pagamento");
    expect(r).not.toHaveProperty("comissao");
  });

  it("categoria ainda sem respostas → {}", () => {
    expect(
      filterDataJsonByPaths(FULL_DATA, resolveRolePaths("terceiro:sindico")),
    ).toEqual({});
  });
});

describe("narrowIncomingToPaths", () => {
  const scope = resolveRolePaths("terceiro:sindico");

  it("mantém só a própria subárvore e reporta o resto", () => {
    const out = narrowIncomingToPaths(
      {
        terceiros: {
          sindico: [{ nome: "OK" }],
          "interveniente-anuente": [{ nome: "INVASOR" }],
        },
        compradores: [{ nome: "INVASOR" }],
      },
      scope,
    );
    expect(out.incoming).toEqual({ terceiros: { sindico: [{ nome: "OK" }] } });
    expect(out.rejectedPaths).toEqual(
      expect.arrayContaining(["compradores", "terceiros.interveniente-anuente"]),
    );
  });

  it("payload 100% fora do escopo vira vazio", () => {
    const out = narrowIncomingToPaths({ pagamento: { valor_total: 1 } }, scope);
    expect(out.incoming).toEqual({});
    expect(out.rejectedPaths).toEqual(["pagamento"]);
  });

  it("top-level não-objeto onde se espera subárvore é rejeitado", () => {
    const out = narrowIncomingToPaths({ terceiros: "hack" }, scope);
    expect(out.incoming).toEqual({});
    expect(out.rejectedPaths).toEqual(["terceiros"]);
  });

  it("escopo raso (nativo) passa a chave inteira", () => {
    const out = narrowIncomingToPaths(
      { vendedores: [{ nome: "X" }], compradores: [{ nome: "Y" }] },
      ROLE_PATHS.vendedor,
    );
    expect(out.incoming).toEqual({ vendedores: [{ nome: "X" }] });
    expect(out.rejectedPaths).toEqual(["compradores"]);
  });
});
