import { describe, it, expect } from "vitest";
import {
  categoryPathScope,
  isValidRole,
  parseCategoryFields,
  parseTerceiroRole,
  participantRoleSchema,
  requiredPathsForCategory,
  slugifyCategoryLabel,
  terceiroRole,
  type ParticipantCategory,
} from "../participant-category";
import { findMissingRequired, getByPath } from "../party-required";

const anuente: ParticipantCategory = {
  id: "cat1",
  slug: "interveniente-anuente",
  label: "Interveniente anuente",
  description: null,
  appliesTo: ["venda"],
  fields: [
    { key: "nome", label: "Nome completo", type: "text", required: true },
    { key: "cpf", label: "CPF", type: "cpf", required: true },
    { key: "obs", label: "Observações", type: "textarea", required: false },
  ],
  active: true,
};

const sindico: ParticipantCategory = {
  id: "cat2",
  slug: "sindico",
  label: "Síndico",
  description: null,
  appliesTo: ["locacao"],
  fields: [],
  active: true,
};

describe("role de terceiro — formato", () => {
  it("terceiroRole + parseTerceiroRole são inversos", () => {
    expect(terceiroRole("sindico")).toBe("terceiro:sindico");
    expect(parseTerceiroRole("terceiro:sindico")).toBe("sindico");
  });

  it("papel nativo não é terceiro", () => {
    for (const r of ["vendedor", "comprador", "locador", "locatario", "fiador"]) {
      expect(parseTerceiroRole(r)).toBeNull();
    }
  });

  it("slug malformado é rejeitado (path traversal / maiúsculas / vazio)", () => {
    expect(parseTerceiroRole("terceiro:../../etc")).toBeNull();
    expect(parseTerceiroRole("terceiro:Sindico")).toBeNull();
    expect(parseTerceiroRole("terceiro:com.ponto")).toBeNull();
    expect(parseTerceiroRole("terceiro:")).toBeNull();
  });

  it("participantRoleSchema aceita nativos e terceiro bem-formado", () => {
    expect(participantRoleSchema.safeParse("vendedor").success).toBe(true);
    expect(participantRoleSchema.safeParse("terceiro:sindico").success).toBe(true);
    expect(participantRoleSchema.safeParse("terceiro:BAD").success).toBe(false);
    expect(participantRoleSchema.safeParse("hacker").success).toBe(false);
  });

  it("slugify normaliza acento e espaço", () => {
    expect(slugifyCategoryLabel("Interveniente Anuente")).toBe(
      "interveniente-anuente",
    );
    expect(slugifyCategoryLabel("Síndico do condomínio")).toBe(
      "sindico-do-condominio",
    );
  });
});

describe("isValidRole — papéis nativos (regra antiga preservada)", () => {
  it("venda aceita vendedor/comprador e recusa os de locação", () => {
    expect(isValidRole("vendedor", "compra_venda_v1", []).ok).toBe(true);
    expect(isValidRole("comprador", "compra_venda_v1", []).ok).toBe(true);
    expect(isValidRole("locador", "compra_venda_v1", []).ok).toBe(false);
    expect(isValidRole("fiador", "compra_venda_v1", []).ok).toBe(false);
  });

  it("locação aceita locador/locatario/fiador e recusa os de venda", () => {
    expect(isValidRole("locador", "locacao_residencial_v1", []).ok).toBe(true);
    expect(isValidRole("locatario", "locacao_residencial_v1", []).ok).toBe(true);
    expect(isValidRole("fiador", "locacao_residencial_v1", []).ok).toBe(true);
    expect(isValidRole("vendedor", "locacao_residencial_v1", []).ok).toBe(false);
  });
});

describe("isValidRole — terceiro", () => {
  it("categoria ativa e no módulo certo passa", () => {
    const r = isValidRole(
      "terceiro:interveniente-anuente",
      "compra_venda_v1",
      [anuente],
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.slug).toBe("interveniente-anuente");
  });

  it("categoria INEXISTENTE é rejeitada", () => {
    const r = isValidRole("terceiro:fantasma", "compra_venda_v1", [anuente]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/não existe/);
  });

  it("categoria INATIVA é rejeitada", () => {
    const r = isValidRole(
      "terceiro:interveniente-anuente",
      "compra_venda_v1",
      [{ ...anuente, active: false }],
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/desativada/);
  });

  it("categoria de MÓDULO ERRADO é rejeitada", () => {
    const r = isValidRole("terceiro:sindico", "compra_venda_v1", [sindico]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/venda/);
  });

  it("slug malformado é rejeitado antes de olhar as categorias", () => {
    const r = isValidRole("terceiro:../x", "compra_venda_v1", [anuente]);
    expect(r.ok).toBe(false);
  });
});

describe("escopo e obrigatoriedade da categoria", () => {
  it("categoryPathScope é sempre a própria subárvore", () => {
    expect(categoryPathScope("sindico")).toEqual(["terceiros.sindico"]);
  });

  it("requiredPathsForCategory só lista os campos required, no slot da parte", () => {
    expect(
      requiredPathsForCategory("interveniente-anuente", 0, anuente.fields),
    ).toEqual([
      "terceiros.interveniente-anuente.0.nome",
      "terceiros.interveniente-anuente.0.cpf",
    ]);
    expect(
      requiredPathsForCategory("interveniente-anuente", 2, anuente.fields),
    ).toEqual([
      "terceiros.interveniente-anuente.2.nome",
      "terceiros.interveniente-anuente.2.cpf",
    ]);
  });

  it("required de field def bloqueia enquanto o campo está vazio", () => {
    const paths = requiredPathsForCategory("interveniente-anuente", 0, anuente.fields);
    const parcial = {
      terceiros: {
        "interveniente-anuente": [{ nome: "Fulano de Tal", obs: "x" }],
      },
    };
    expect(findMissingRequired(paths, (p) => getByPath(parcial, p))).toEqual([
      "terceiros.interveniente-anuente.0.cpf",
    ]);

    const completo = {
      terceiros: {
        "interveniente-anuente": [
          { nome: "Fulano de Tal", cpf: "111.222.333-44" },
        ],
      },
    };
    expect(findMissingRequired(paths, (p) => getByPath(completo, p))).toEqual([]);
  });

  it("categoria sem campo obrigatório não bloqueia nada", () => {
    expect(requiredPathsForCategory("sindico", 0, sindico.fields)).toEqual([]);
  });
});

describe("parseCategoryFields (defensivo contra Json legado)", () => {
  it("descarta itens inválidos e chaves duplicadas", () => {
    const raw = [
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "nome", label: "Nome de novo", type: "text", required: false },
      { key: "BAD KEY", label: "x", type: "text", required: false },
      { key: "tipo", label: "t", type: "inexistente", required: false },
      "lixo",
    ];
    expect(parseCategoryFields(raw)).toEqual([
      { key: "nome", label: "Nome", type: "text", required: true },
    ]);
  });

  it("não-array vira lista vazia", () => {
    expect(parseCategoryFields(null)).toEqual([]);
    expect(parseCategoryFields({ a: 1 })).toEqual([]);
  });
});
