import { describe, it, expect } from "vitest";

import {
  filterGrouping,
  mergeFamilyPlans,
  planFamilyKey,
  splitBatchByFamily,
} from "@/lib/ingestion/plan-fanout";
import { LIBRARY_PLAN_VERSION, type LibraryPlan } from "@/lib/ingestion/library-plan";
import type { GroupingReport } from "@/lib/ingestion/grouping";

function item(id: string, modalidade: string | null) {
  return { id, classification: modalidade === null ? null : { modalidade } };
}

const GROUPING: GroupingReport = {
  families: [
    { familyKey: "contrato_locacao:locacao:fiador", itemIds: ["r1", "r2"] },
    { familyKey: "contrato_locacao:locacao_comercial:caucao", itemIds: ["c1"] },
  ],
  groups: [
    {
      id: "g1",
      familyKey: "contrato_locacao:locacao:fiador",
      memberIds: ["r1", "r2"],
      minSimilarity: 0.9,
      minContainment: 0.9,
      linkedBy: "similarity",
      referenceItemId: "r1",
    } as GroupingReport["groups"][number],
  ],
  singles: ["c1"],
  groupedAt: "2026-08-27T00:00:00.000Z",
};

function plan(over: Partial<LibraryPlan>): LibraryPlan {
  return {
    version: LIBRARY_PLAN_VERSION,
    templates: [],
    clauses: [],
    discards: [],
    issues: [],
    confidence: 0.9,
    ...over,
  };
}

describe("planFamilyKey", () => {
  it("separa locação residencial de comercial — os dois maiores volumes", () => {
    expect(planFamilyKey("locacao")).toBe("locacao");
    expect(planFamilyKey("locacao_comercial")).toBe("locacao_comercial");
  });

  it("segue o playbook nas demais famílias", () => {
    expect(planFamilyKey("administracao_locacao")).toBe("administracao");
    expect(planFamilyKey("a_vista")).toBe("venda");
    expect(planFamilyKey("proposta_venda")).toBe("proposta");
    expect(planFamilyKey(null)).toBeNull();
    expect(planFamilyKey("inexistente")).toBeNull();
  });
});

describe("splitBatchByFamily", () => {
  it("reparte por família e recorta o agrupamento de cada uma", () => {
    const splits = splitBatchByFamily(
      [item("r1", "locacao"), item("r2", "locacao"), item("c1", "locacao_comercial")],
      GROUPING
    );
    expect(splits.map((s) => s.key)).toEqual(["locacao", "locacao_comercial"]);
    const res = splits[0];
    expect(res.items.map((i) => i.id)).toEqual(["r1", "r2"]);
    expect(res.grouping.groups).toHaveLength(1);
    expect(res.grouping.singles).toEqual([]);
    const com = splits[1];
    expect(com.grouping.groups).toHaveLength(0);
    expect(com.grouping.singles).toEqual(["c1"]);
  });

  it("item sem modalidade vai para a MAIOR família — precisa de um planner para ser descartado com motivo", () => {
    const splits = splitBatchByFamily(
      [item("r1", "locacao"), item("r2", "locacao"), item("c1", "locacao_comercial"), item("x", null)],
      GROUPING
    );
    const res = splits.find((s) => s.key === "locacao")!;
    expect(res.items.map((i) => i.id)).toContain("x");
  });

  it("lote inteiro sem modalidade vira uma família única (compat com o planner antigo)", () => {
    const splits = splitBatchByFamily([item("a", null), item("b", null)], GROUPING);
    expect(splits).toHaveLength(1);
    expect(splits[0].key).toBe("lote");
    expect(splits[0].items).toHaveLength(2);
  });
});

describe("filterGrouping", () => {
  it("nunca deixa um grupo com membro de fora da família", () => {
    const out = filterGrouping(GROUPING, new Set(["r1"]));
    // g1 tem r2, que está fora — o grupo inteiro sai (grupos não atravessam
    // famílias por construção; se atravessou, é projeção incompleta).
    expect(out.groups).toHaveLength(0);
    expect(out.families[0].itemIds).toEqual(["r1"]);
  });
});

describe("mergeFamilyPlans — o dedup determinístico das cláusulas", () => {
  const clausePorto = (content: string, title = "Seguro-fiança — Porto Seguro") => ({
    slot: "garantia" as const,
    value: "seguro_fianca",
    provider: "Porto Seguro",
    title,
    content,
    sourceItemId: "r1",
    tags: ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"],
    rationale: "",
  });

  it("residencial e comercial propõem a MESMA cláusula — fica uma, a mais completa", () => {
    // O caso que o guardrail recusou no lote de staging, agora resolvido por
    // regra em vez de retry: a cláusula de fornecedor é uma só (regra 3).
    const merged = mergeFamilyPlans([
      {
        key: "locacao",
        accepted: true,
        plan: plan({ clauses: [clausePorto("Redação completa da cláusula, mais longa.")] }),
      },
      {
        key: "locacao_comercial",
        accepted: true,
        plan: plan({ clauses: [clausePorto("Redação curta.", "Porto (comercial)")] }),
      },
    ]);
    expect(merged.plan.clauses).toHaveLength(1);
    expect(merged.plan.clauses[0].content).toContain("mais longa");
    expect(merged.dedupedClauses).toEqual([
      { kept: "Seguro-fiança — Porto Seguro", dropped: "Porto (comercial)" },
    ]);
  });

  it("conjuntos de tags diferentes NÃO fundem", () => {
    const almada = {
      ...clausePorto("Texto Almada"),
      provider: "Almada",
      tags: ["slot:garantia", "garantia:garantia_onerosa", "provider:almada"],
    };
    const merged = mergeFamilyPlans([
      { key: "a", accepted: true, plan: plan({ clauses: [clausePorto("X longa o bastante")] }) },
      { key: "b", accepted: true, plan: plan({ clauses: [almada] }) },
    ]);
    expect(merged.plan.clauses).toHaveLength(2);
  });

  it("confiança final é a MÍNIMA e aceito exige todas", () => {
    const merged = mergeFamilyPlans([
      { key: "a", accepted: true, plan: plan({ confidence: 0.9 }) },
      { key: "b", accepted: false, plan: plan({ confidence: 0.4 }) },
    ]);
    expect(merged.plan.confidence).toBe(0.4);
    expect(merged.accepted).toBe(false);
  });

  it("templates, descartes e issues concatenam", () => {
    const merged = mergeFamilyPlans([
      {
        key: "a",
        accepted: true,
        plan: plan({
          templates: [
            {
              sourceItemId: "r1",
              name: "T1",
              modalidade: "locacao",
              matchCriteria: { garantia: "fiador" },
              rationale: "",
            },
          ],
          issues: [{ itemId: null, kind: "acervo_incompleto", detail: "x" }],
        }),
      },
      {
        key: "b",
        accepted: true,
        plan: plan({
          discards: [{ itemId: "c1", reason: "filled_instance", detail: "y" }],
        }),
      },
    ]);
    expect(merged.plan.templates).toHaveLength(1);
    expect(merged.plan.discards).toHaveLength(1);
    expect(merged.plan.issues).toHaveLength(1);
  });
});
