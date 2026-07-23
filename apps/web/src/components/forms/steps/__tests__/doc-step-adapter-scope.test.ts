import { describe, it, expect } from "vitest";
import type { SelectGroup } from "@/components/forms/NativeSelect";
import {
  filterAssignmentOptionsByScope,
  readPersistedAssignment,
  vendaTopKeyForKind,
} from "@/components/forms/steps/doc-step-adapter";
import { locacaoDocAdapter } from "@/components/forms/steps/locacao/locacao-doc-adapter";

// Fix 2 (links por parte): nos subtokens só devem aparecer slots de atribuição
// do papel da pessoa (ROLE_PATHS[role]). Sem isso, um comprador conseguia
// atribuir um doc a "Vendedor 1" e o autofill era descartado no save.

// Espelha o shape de buildAssignmentOptions (venda).
const VENDA_GROUPS: SelectGroup[] = [
  {
    label: "Vendedores",
    options: [
      { value: "vendedor:0", label: "Vendedor 1" },
      { value: "vendedor:new", label: "+ Novo vendedor" },
    ],
  },
  {
    label: "Compradores",
    options: [
      { value: "comprador:0", label: "Comprador 1" },
      { value: "comprador:new", label: "+ Novo comprador" },
    ],
  },
  {
    label: "Cônjuges",
    options: [{ value: "conjuge_vendedor:0", label: "Cônjuge de Vendedor 1" }],
  },
  { label: "Imóveis", options: [{ value: "imovel:0", label: "Imóvel 1" }] },
  { label: "Outros", options: [{ value: "outro:0", label: "Outros (sem aplicar)" }] },
];

const groupLabels = (groups: SelectGroup[]) => groups.map((g) => g.label);

describe("filterAssignmentOptionsByScope (venda)", () => {
  it("comprador → só Compradores + Outros", () => {
    const out = filterAssignmentOptionsByScope(
      VENDA_GROUPS,
      ["compradores"],
      vendaTopKeyForKind
    );
    expect(groupLabels(out)).toEqual(["Compradores", "Outros"]);
    expect(out.find((g) => g.label === "Compradores")!.options).toHaveLength(2);
  });

  it("vendedor → Vendedores + Cônjuges + Imóveis + Outros (sem Compradores)", () => {
    const out = filterAssignmentOptionsByScope(
      VENDA_GROUPS,
      ["vendedores", "imoveis"],
      vendaTopKeyForKind
    );
    expect(groupLabels(out)).toEqual([
      "Vendedores",
      "Cônjuges",
      "Imóveis",
      "Outros",
    ]);
    expect(groupLabels(out)).not.toContain("Compradores");
  });

  it("undefined (token principal) → grupos intactos", () => {
    const out = filterAssignmentOptionsByScope(
      VENDA_GROUPS,
      undefined,
      vendaTopKeyForKind
    );
    expect(out).toEqual(VENDA_GROUPS);
  });

  it("remove grupos que ficam vazios após o filtro", () => {
    const out = filterAssignmentOptionsByScope(
      VENDA_GROUPS,
      ["compradores"],
      vendaTopKeyForKind
    );
    expect(out.every((g) => g.options.length > 0)).toBe(true);
  });
});

describe("filterAssignmentOptionsByScope (locação)", () => {
  const LOCACAO_GROUPS: SelectGroup[] = [
    { label: "Locadores", options: [{ value: "locador:0", label: "Locador 1" }] },
    { label: "Locatários", options: [{ value: "locatario:0", label: "Locatário 1" }] },
    { label: "Fiador", options: [{ value: "fiador:0", label: "Fiador" }] },
    { label: "Imóvel", options: [{ value: "imovel:0", label: "Imóvel" }] },
    { label: "Outros", options: [{ value: "outro:0", label: "Outros (sem aplicar)" }] },
  ];

  it("locador → Locadores + Imóvel + Outros", () => {
    const out = filterAssignmentOptionsByScope(
      LOCACAO_GROUPS,
      ["locadores", "imovel"],
      locacaoDocAdapter.topKeyForKind
    );
    expect(groupLabels(out)).toEqual(["Locadores", "Imóvel", "Outros"]);
  });

  it("fiador → só Fiador (garantia) + Outros", () => {
    const out = filterAssignmentOptionsByScope(
      LOCACAO_GROUPS,
      ["garantia"],
      locacaoDocAdapter.topKeyForKind
    );
    expect(groupLabels(out)).toEqual(["Fiador", "Outros"]);
  });
});

// Fix 1 (reflexão da categorização da parte): o restore prefere o assignment
// persistido em extractedData.assignment em vez de re-sugerir.
describe("readPersistedAssignment", () => {
  it("lê um assignment válido {kind,index}", () => {
    expect(
      readPersistedAssignment({ assignment: { kind: "comprador", index: 1 } })
    ).toEqual({ kind: "comprador", index: 1 });
  });

  it("null quando ausente, inválido ou shape errado", () => {
    expect(readPersistedAssignment(null)).toBeNull();
    expect(readPersistedAssignment({})).toBeNull();
    expect(readPersistedAssignment({ assignment: null })).toBeNull();
    expect(readPersistedAssignment({ assignment: { kind: "comprador" } })).toBeNull();
    expect(
      readPersistedAssignment({ assignment: { kind: 1, index: "x" } })
    ).toBeNull();
  });

  it("null pra kind desconhecido e índice perigoso (não auto-aplica lixo)", () => {
    // Vetores do code review: kind fora do conjunto e índice sem limite.
    expect(
      readPersistedAssignment({ assignment: { kind: "hacker", index: 0 } })
    ).toBeNull();
    expect(
      readPersistedAssignment({ assignment: { kind: "comprador", index: Infinity } })
    ).toBeNull();
    expect(
      readPersistedAssignment({ assignment: { kind: "comprador", index: 1e12 } })
    ).toBeNull();
    expect(
      readPersistedAssignment({ assignment: { kind: "comprador", index: -1 } })
    ).toBeNull();
  });
});
