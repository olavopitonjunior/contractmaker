import { describe, it, expect } from "vitest";
import {
  defaultDecisions,
  setField,
  setAllForClause,
  countApproved,
  buildReviewedItems,
} from "@/lib/clauses/proposal-review";
import type { ClauseClassificationProposal } from "@/lib/clauses/classify";

function proposal(over: Partial<ClauseClassificationProposal> = {}): ClauseClassificationProposal {
  return {
    clauseId: "cl1",
    version: 1,
    title: "T",
    fields: {
      esteira: { current: null, proposed: "locacao" },
      subcategory: { current: null, proposed: "vistoria" },
      content: {
        current: "3 aluguéis",
        proposed: "{{config.multa_rescisoria_meses}} aluguéis",
        mappings: [{ trecho: "3", chave: "config.multa_rescisoria_meses", tier: "validada" }],
        rejected: [],
      },
    },
    warnings: [],
    reason: "r",
    ...over,
  };
}

describe("defaultDecisions", () => {
  it("marca metadados e DEIXA o conteúdo desmarcado", () => {
    // Conteúdo reescreve texto contratual e alcança todo contrato vinculado —
    // aprovar tem que ser deliberado, não o default.
    const d = defaultDecisions([proposal()]);
    expect(d.cl1.esteira).toBe(true);
    expect(d.cl1.subcategory).toBe(true);
    expect(d.cl1.content).toBe(false);
  });

  it("não inventa decisão para campo que a proposta não traz", () => {
    const d = defaultDecisions([
      proposal({ fields: { esteira: { current: null, proposed: "venda" } } }),
    ]);
    expect(d.cl1.tags).toBeUndefined();
    expect(d.cl1.content).toBeUndefined();
  });
});

describe("buildReviewedItems — fail-closed", () => {
  it("envia só o que está marcado true", () => {
    const p = proposal();
    const items = buildReviewedItems([p], defaultDecisions([p]));
    expect(items).toHaveLength(1);
    expect(items[0].approve).toEqual({ esteira: true, subcategory: true });
    expect(items[0].values).toEqual({ esteira: "locacao", subcategory: "vistoria" });
    // O conteúdo não entra sem aprovação explícita.
    expect(items[0].values.content).toBeUndefined();
  });

  it("campo com decisão AUSENTE não é aplicado", () => {
    const p = proposal();
    const items = buildReviewedItems([p], { cl1: {} });
    expect(items).toHaveLength(0);
  });

  it("campo explicitamente false não é aplicado", () => {
    const p = proposal();
    const items = buildReviewedItems([p], { cl1: { esteira: false, subcategory: true } });
    expect(items[0].approve).toEqual({ subcategory: true });
  });

  it("valor truthy que não seja true não conta", () => {
    const p = proposal();
    const items = buildReviewedItems([p], {
      cl1: { esteira: 1 as unknown as boolean },
    });
    expect(items).toHaveLength(0);
  });

  it("conteúdo aprovado leva o texto proposto", () => {
    const p = proposal();
    const items = buildReviewedItems([p], { cl1: { content: true } });
    expect(items[0].values.content).toContain("{{config.multa_rescisoria_meses}}");
  });

  it("cláusula sem nada aprovado é omitida do payload", () => {
    const a = proposal();
    const b = proposal({ clauseId: "cl2" });
    const items = buildReviewedItems([a, b], { cl1: { esteira: true }, cl2: {} });
    expect(items.map((i) => i.clauseId)).toEqual(["cl1"]);
  });
});

describe("setField / setAllForClause / countApproved", () => {
  it("setField altera só o campo pedido", () => {
    const p = proposal();
    const d = setField(defaultDecisions([p]), "cl1", "content", true);
    expect(d.cl1.content).toBe(true);
    expect(d.cl1.esteira).toBe(true);
  });

  it("setAllForClause cobre só os campos propostos", () => {
    const p = proposal();
    const d = setAllForClause(defaultDecisions([p]), p, true);
    expect(d.cl1).toEqual({ esteira: true, subcategory: true, content: true });
    const off = setAllForClause(d, p, false);
    expect(Object.values(off.cl1).every((v) => v === false)).toBe(true);
  });

  it("countApproved soma campos, não cláusulas", () => {
    const p = proposal();
    expect(countApproved(defaultDecisions([p]))).toBe(2);
    expect(countApproved(setAllForClause(defaultDecisions([p]), p, true))).toBe(3);
  });
});
