import { describe, it, expect } from "vitest";
import {
  parseAssignment,
  assignmentAllowedForRole,
  topKeyForKind,
  MAX_ASSIGNMENT_INDEX,
} from "../assignment-scope";

// O assignment persistido passou a ser lido de volta e AUTO-APLICADO (Fix 1/3),
// então é entrada não-confiável. Estes testes cobrem os dois vetores achados no
// code review: índice sem limite (DoS no ensureSlot) e kind fora do papel
// (injeção cross-role).

describe("parseAssignment — saneamento", () => {
  it("aceita {kind,index} válido e devolve só esses campos", () => {
    expect(parseAssignment({ kind: "comprador", index: 0 })).toEqual({
      kind: "comprador",
      index: 0,
    });
    // Descarta props injetadas.
    expect(
      parseAssignment({ kind: "vendedor", index: 2, evil: "x", __proto__: {} })
    ).toEqual({ kind: "vendedor", index: 2 });
  });

  it("rejeita kind desconhecido", () => {
    expect(parseAssignment({ kind: "admin", index: 0 })).toBeNull();
    expect(parseAssignment({ kind: "", index: 0 })).toBeNull();
    expect(parseAssignment({ kind: 1, index: 0 })).toBeNull();
  });

  it("rejeita index não-inteiro/negativo/Infinity/NaN/acima do teto (DoS)", () => {
    expect(parseAssignment({ kind: "comprador", index: -1 })).toBeNull();
    expect(parseAssignment({ kind: "comprador", index: 1.5 })).toBeNull();
    expect(parseAssignment({ kind: "comprador", index: Infinity })).toBeNull();
    expect(parseAssignment({ kind: "comprador", index: NaN })).toBeNull();
    expect(parseAssignment({ kind: "comprador", index: 1e12 })).toBeNull();
    expect(
      parseAssignment({ kind: "comprador", index: MAX_ASSIGNMENT_INDEX + 1 })
    ).toBeNull();
    // Limite inclusivo passa.
    expect(
      parseAssignment({ kind: "comprador", index: MAX_ASSIGNMENT_INDEX })
    ).toEqual({ kind: "comprador", index: MAX_ASSIGNMENT_INDEX });
  });

  it("rejeita shape ausente/errado", () => {
    expect(parseAssignment(null)).toBeNull();
    expect(parseAssignment(undefined)).toBeNull();
    expect(parseAssignment("x")).toBeNull();
    expect(parseAssignment({})).toBeNull();
    expect(parseAssignment({ kind: "comprador" })).toBeNull();
  });
});

describe("topKeyForKind — imovel depende da esteira", () => {
  it("venda: imovel → imoveis; locação: imovel → imovel", () => {
    expect(topKeyForKind("imovel", "venda")).toBe("imoveis");
    expect(topKeyForKind("imovel", "locacao")).toBe("imovel");
  });
  it("fiador → garantia; outro → null", () => {
    expect(topKeyForKind("fiador", "locacao")).toBe("garantia");
    expect(topKeyForKind("outro", "venda")).toBeNull();
  });
});

describe("assignmentAllowedForRole — escopo cross-role (segurança)", () => {
  it("comprador NÃO pode atribuir a vendedor/imóvel", () => {
    expect(assignmentAllowedForRole("vendedor", "comprador", "venda")).toBe(false);
    expect(assignmentAllowedForRole("imovel", "comprador", "venda")).toBe(false);
    expect(assignmentAllowedForRole("conjuge_vendedor", "comprador", "venda")).toBe(
      false
    );
  });
  it("comprador pode atribuir a comprador (e derivados)", () => {
    expect(assignmentAllowedForRole("comprador", "comprador", "venda")).toBe(true);
    expect(assignmentAllowedForRole("conjuge_comprador", "comprador", "venda")).toBe(
      true
    );
  });
  it("vendedor pode vendedores + imoveis, não compradores", () => {
    expect(assignmentAllowedForRole("vendedor", "vendedor", "venda")).toBe(true);
    expect(assignmentAllowedForRole("imovel", "vendedor", "venda")).toBe(true);
    expect(assignmentAllowedForRole("comprador", "vendedor", "venda")).toBe(false);
  });
  it("locador pode locadores + imovel; fiador só garantia", () => {
    expect(assignmentAllowedForRole("locador", "locador", "locacao")).toBe(true);
    expect(assignmentAllowedForRole("imovel", "locador", "locacao")).toBe(true);
    expect(assignmentAllowedForRole("locatario", "locador", "locacao")).toBe(false);
    expect(assignmentAllowedForRole("fiador", "fiador", "locacao")).toBe(true);
    expect(assignmentAllowedForRole("imovel", "fiador", "locacao")).toBe(false);
  });
  it("outro (não escreve) é sempre permitido", () => {
    expect(assignmentAllowedForRole("outro", "comprador", "venda")).toBe(true);
  });
});
