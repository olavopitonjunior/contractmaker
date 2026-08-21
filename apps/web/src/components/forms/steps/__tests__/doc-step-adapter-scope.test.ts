import { describe, it, expect, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import type { SelectGroup } from "@/components/forms/NativeSelect";
import {
  computeDocWrites,
  createVendaAdapter,
  filterAssignmentOptionsByScope,
  readPersistedAssignment,
  vendaTopKeyForKind,
} from "@/components/forms/steps/doc-step-adapter";
import { locacaoDocAdapter } from "@/components/forms/steps/locacao/locacao-doc-adapter";
import { buildAssignmentOptions } from "@/components/forms/steps/build-assignment-options";

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

describe("escopo por subtoken sobre os grupos REAIS (com sub-slots)", () => {
  const groups = buildAssignmentOptions(
    {
      vendedores: [{ tipo_pessoa: "fisica" }],
      compradores: [{ tipo_pessoa: "fisica" }],
    },
    []
  );

  it("subtoken do vendedor vê cônjuge/procurador/representante DO VENDEDOR", () => {
    const out = filterAssignmentOptionsByScope(
      groups,
      ["vendedores", "imoveis"],
      vendaTopKeyForKind
    );
    const values = out.flatMap((g) => g.options.map((o) => o.value));
    expect(values).toContain("conjuge_vendedor:0");
    expect(values).toContain("procurador_vendedor:0");
    expect(values).toContain("representante_vendedor:0");
    expect(values.some((v) => v.includes("comprador"))).toBe(false);
  });

  it("subtoken do comprador não enxerga nenhum slot de vendedor", () => {
    const out = filterAssignmentOptionsByScope(
      groups,
      ["compradores"],
      vendaTopKeyForKind
    );
    const values = out.flatMap((g) => g.options.map((o) => o.value));
    expect(values).toContain("procurador_comprador:0");
    expect(values.some((v) => v.includes("vendedor"))).toBe(false);
    expect(values.some((v) => v.startsWith("imovel"))).toBe(false);
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

// D7 (2026-07-31) — reatribuir um doc já aplicado precisa limpar o slot ANTIGO.
// `computeDocWrites` recalcula o que aquele apply escreveu sem tocar no form.
describe("computeDocWrites + limpeza da reatribuição", () => {
  const adapter = createVendaAdapter(buildAssignmentOptions);
  const RG = {
    category: "rg",
    fields: {
      nome_completo: "Maria Vendedora",
      cpf_numero: "12345678909",
      rg_numero: "1234567",
    },
    confidence: 0.9,
  };

  function makeFormStub(initial: Record<string, unknown> = {}) {
    const store = new Map<string, unknown>(Object.entries(initial));
    const form = {
      setValue: vi.fn((path: string, value: unknown) => store.set(path, value)),
      getValues: vi.fn((path?: string) =>
        path === undefined ? Object.fromEntries(store) : store.get(path)
      ),
      // O autofill limpa o erro do campo que preenche; sem este mock o stub
      // mentiria sobre a interface que o código usa.
      clearErrors: vi.fn(),
    } as unknown as UseFormReturn<Record<string, unknown>>;
    return { form, store };
  }

  /** Espelha o trecho de limpeza do handleAssignmentChange. */
  function clearOldSlot(
    form: UseFormReturn<Record<string, unknown>>,
    assignment: { kind: string; index: number }
  ) {
    const writes = computeDocWrites(adapter, RG, assignment as never, form);
    for (const [path, value] of writes) {
      if (form.getValues(path as never) !== value) continue;
      form.setValue(path, (typeof value === "string" ? "" : undefined) as never, {
        shouldDirty: true,
      });
    }
  }

  it("devolve o mapa de writes sem tocar o form real", () => {
    const { form, store } = makeFormStub();
    const writes = computeDocWrites(adapter, RG, { kind: "vendedor", index: 0 }, form);
    expect(writes.get("vendedores.0.nome")).toBe("Maria Vendedora");
    expect(writes.get("vendedores.0.cpf")).toBe("12345678909");
    expect(store.size).toBe(0);
  });

  it("ignora skipIfDirty — captura writes mesmo com o campo já preenchido", () => {
    const { form } = makeFormStub({ "vendedores.0.nome": "Digitado" });
    const writes = computeDocWrites(adapter, RG, { kind: "vendedor", index: 0 }, form);
    expect(writes.get("vendedores.0.nome")).toBe("Maria Vendedora");
  });

  it("limpa o slot antigo mas preserva o que o usuário digitou por cima", () => {
    const { form, store } = makeFormStub();
    adapter.apply(RG, { kind: "vendedor", index: 0 }, form, { skipIfDirty: true });
    expect(store.get("vendedores.0.cpf")).toBe("12345678909");
    // Operador corrigiu o nome à mão antes de perceber que o doc era do V2.
    store.set("vendedores.0.nome", "Nome Corrigido À Mão");

    clearOldSlot(form, { kind: "vendedor", index: 0 });

    expect(store.get("vendedores.0.cpf")).toBe("");
    expect(store.get("vendedores.0.rg")).toBe("");
    expect(store.get("vendedores.0.nome")).toBe("Nome Corrigido À Mão");
  });

  it("limpeza de sub-slot não estoura pra fora do subobjeto", () => {
    const { form, store } = makeFormStub({ "vendedores.0.nome": "João Titular" });
    adapter.apply(RG, { kind: "procurador_vendedor", index: 0 }, form, {
      skipIfDirty: true,
    });
    expect(store.get("vendedores.0.procurador.nome")).toBe("Maria Vendedora");
    expect(store.get("vendedores.0.tem_procurador")).toBe(true);

    clearOldSlot(form, { kind: "procurador_vendedor", index: 0 });

    expect(store.get("vendedores.0.procurador.nome")).toBe("");
    expect(store.get("vendedores.0.nome")).toBe("João Titular");
    // `tem_procurador` já estava true no form real → não entra no mapa e fica.
    expect(store.get("vendedores.0.tem_procurador")).toBe(true);
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
