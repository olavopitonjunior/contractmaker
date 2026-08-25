import { describe, it, expect } from "vitest";
import { LIBRARY_PLAN_VERSION, type LibraryPlan } from "@/lib/ingestion/library-plan";
import {
  buildReviewedPlan,
  clauseKey,
  countApproved,
  defaultDecisions,
  parseLibraryPlan,
  parseReviewedPlan,
  selectApproved,
  setAllDecisions,
} from "@/lib/ingestion/plan-review";

function plan(over: Partial<LibraryPlan> = {}): LibraryPlan {
  return {
    version: LIBRARY_PLAN_VERSION,
    templates: [
      {
        sourceItemId: "item-0",
        name: "Locação com fiador",
        modalidade: "locacao",
        matchCriteria: { garantia: "fiador" },
        rationale: "…",
      },
      {
        sourceItemId: "item-1",
        name: "Locação com caução",
        modalidade: "locacao",
        matchCriteria: { garantia: "caucao" },
        rationale: "…",
      },
    ],
    clauses: [
      {
        slot: "garantia",
        value: "fiador",
        provider: null,
        title: "Fiador",
        content: "texto",
        sourceItemId: "item-0",
        tags: ["slot:garantia", "garantia:fiador"],
        rationale: "…",
      },
    ],
    discards: [{ itemId: "item-2", reason: "duplicate", detail: "Igual ao item-0." }],
    issues: [],
    confidence: 0.8,
    ...over,
  };
}

describe("clauseKey", () => {
  it("é estável sob ordem, caixa e repetição das tags", () => {
    const a = clauseKey({
      sourceItemId: "i",
      tags: ["garantia:fiador", "SLOT:garantia", "garantia:fiador"],
    });
    const b = clauseKey({ sourceItemId: "i", tags: ["slot:garantia", "garantia:fiador"] });
    expect(a).toBe(b);
  });

  it("separa a cláusula genérica da cláusula de fornecedor do MESMO arquivo", () => {
    const generica = clauseKey({
      sourceItemId: "i",
      tags: ["slot:garantia", "garantia:seguro_fianca"],
    });
    const porto = clauseKey({
      sourceItemId: "i",
      tags: ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"],
    });
    expect(generica).not.toBe(porto);
  });
});

describe("parseLibraryPlan", () => {
  it("recusa versão desconhecida — meio plano é pior que nenhum", () => {
    expect(parseLibraryPlan({ ...plan(), version: 99 })).toBeNull();
  });

  it("descarta entradas malformadas em vez de quebrar a tela", () => {
    const parsed = parseLibraryPlan({
      ...plan(),
      templates: [{ sourceItemId: "item-0", name: "ok", modalidade: "locacao" }, { name: 3 }],
    });
    expect(parsed!.templates).toHaveLength(1);
  });

  it("null/undefined viram null", () => {
    expect(parseLibraryPlan(null)).toBeNull();
    expect(parseLibraryPlan("{}")).toBeNull();
  });
});

describe("parseReviewedPlan", () => {
  it("só `true` literal aprova — qualquer outra coisa é recusa", () => {
    const parsed = parseReviewedPlan({
      reviewedBy: "u",
      reviewedAt: "2026-08-25T00:00:00.000Z",
      templates: [
        { sourceItemId: "a", approved: true },
        { sourceItemId: "b", approved: "sim" },
        { sourceItemId: "c", approved: 1 },
      ],
      clauses: [],
      discards: [],
    });
    expect(parsed!.templates.map((t) => t.approved)).toEqual([true, false, false]);
  });

  it("sem quem revisou, não é plano revisado", () => {
    expect(parseReviewedPlan({ templates: [], clauses: [], discards: [] })).toBeNull();
  });
});

describe("selectApproved — fail-closed", () => {
  it("aplica só o que tem approved:true explícito", () => {
    const p = plan();
    const selection = selectApproved(p, {
      reviewedBy: "u",
      reviewedAt: "2026-08-25T00:00:00.000Z",
      templates: [
        { sourceItemId: "item-0", approved: true },
        { sourceItemId: "item-1", approved: false },
      ],
      clauses: [{ sourceItemId: "item-0", tags: p.clauses[0].tags, approved: true }],
      discards: [],
    });

    expect(selection.templates.map((t) => t.sourceItemId)).toEqual(["item-0"]);
    expect(selection.rejectedTemplates.map((t) => t.sourceItemId)).toEqual(["item-1"]);
    expect(selection.clauses).toHaveLength(1);
  });

  it("item do plano SEM entrada na revisão não é aplicado", () => {
    const p = plan();
    const selection = selectApproved(p, {
      reviewedBy: "u",
      reviewedAt: "2026-08-25T00:00:00.000Z",
      templates: [],
      clauses: [],
      discards: [],
    });
    expect(selection.templates).toHaveLength(0);
    expect(selection.rejectedTemplates).toHaveLength(2);
  });

  it("a cláusula é casada pelo conjunto de tags, não pela ordem delas", () => {
    const p = plan();
    const selection = selectApproved(p, {
      reviewedBy: "u",
      reviewedAt: "2026-08-25T00:00:00.000Z",
      templates: [],
      clauses: [
        { sourceItemId: "item-0", tags: ["garantia:fiador", "slot:garantia"], approved: true },
      ],
      discards: [],
    });
    expect(selection.clauses).toHaveLength(1);
  });
});

describe("decisões da tela", () => {
  it("tudo nasce marcado — a revisão é para vetar, não para reconstruir", () => {
    const p = plan();
    const d = defaultDecisions(p);
    expect(countApproved(d)).toEqual({ templates: 2, clauses: 1, total: 3 });
  });

  it("desmarcar tudo não ressuscita arquivo descartado", () => {
    const p = plan();
    const d = setAllDecisions(p, false);
    expect(countApproved(d).total).toBe(0);
    expect(d.discards["item-2"]).toBe(true);
  });

  it("o que foi desmarcado vai pro plano revisado com approved:false", () => {
    const p = plan();
    const decisions = defaultDecisions(p);
    decisions.templates["item-1"] = false;

    const reviewed = buildReviewedPlan(p, decisions, {
      reviewedBy: "user-1",
      reviewedAt: "2026-08-25T12:00:00.000Z",
    });

    // Recusado NÃO some: o relatório precisa saber dizer o que foi vetado.
    expect(reviewed.templates).toEqual([
      { sourceItemId: "item-0", approved: true },
      { sourceItemId: "item-1", approved: false },
    ]);
    expect(reviewed.reviewedBy).toBe("user-1");
  });

  it("as tags da cláusula viajam canônicas no plano revisado", () => {
    const p = plan({
      clauses: [
        {
          slot: "garantia",
          value: "fiador",
          provider: null,
          title: "Fiador",
          content: "texto",
          sourceItemId: "item-0",
          tags: ["GARANTIA:fiador", "slot:garantia"],
          rationale: "…",
        },
      ],
    });
    const reviewed = buildReviewedPlan(p, defaultDecisions(p), {
      reviewedBy: "u",
      reviewedAt: "2026-08-25T12:00:00.000Z",
    });
    expect(reviewed.clauses[0].tags).toEqual(["garantia:fiador", "slot:garantia"]);
  });
});
