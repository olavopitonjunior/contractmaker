/**
 * Guard de FORMA dos JSON Schemas enviados a `runStructured`.
 *
 * Motivo: o validador de `output_config.format` da API recusa
 * `{ type: ["string","null"], enum: [...] }` com 400 — ele checa cada valor do
 * enum contra o `type` declarado e não destrincha a união. O erro só aparece
 * em chamada REAL: toda suíte mocka o runner, então nenhum teste de
 * comportamento pega. Este arquivo checa o schema como DADO.
 *
 * Custou um smoke em staging (13 cláusulas, 13 erros 400) depois de o helper
 * `nullableEnum` já existir no repo com um docblock avisando exatamente disto.
 */
import { describe, it, expect } from "vitest";
import { nullableEnum, nullableString } from "@/lib/ai/shared/anthropic-structured";
import { CLAUSE_CLASSIFICATION_SCHEMA } from "@/lib/clauses/classifier-llm";
import { CLASSIFICATION_SCHEMA } from "@/lib/ingestion/llm-classifier";
import { PLAN_SCHEMA } from "@/lib/ingestion/planner";

/** Caminhos que usam a combinação recusada pela API. */
function forbiddenUnions(node: unknown, path = "$"): string[] {
  if (!node || typeof node !== "object") return [];
  const out: string[] = [];

  if (!Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    const type = obj.type;
    // A combinação proibida: `type` como UNIÃO que inclui "null" E um `enum`.
    if (Array.isArray(type) && type.includes("null") && Array.isArray(obj.enum)) {
      out.push(path);
    }
    for (const [k, v] of Object.entries(obj)) {
      out.push(...forbiddenUnions(v, `${path}.${k}`));
    }
    return out;
  }

  node.forEach((v, i) => out.push(...forbiddenUnions(v, `${path}[${i}]`)));
  return out;
}

const SCHEMAS: Array<[string, Record<string, unknown>]> = [
  ["clause classification", CLAUSE_CLASSIFICATION_SCHEMA],
  ["ingestion classification", CLASSIFICATION_SCHEMA],
  ["ingestion plan", PLAN_SCHEMA],
];

describe("nenhum schema usa enum com type-união nulo", () => {
  for (const [name, schema] of SCHEMAS) {
    it(name, () => {
      // Se falhar, troque o campo por `nullableEnum(...)`.
      expect(forbiddenUnions(schema)).toEqual([]);
    });
  }
});

describe("helpers produzem a forma que a API aceita", () => {
  it("nullableEnum usa anyOf com ramos consistentes", () => {
    expect(nullableEnum(["a", "b"], "d")).toEqual({
      anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }],
      description: "d",
    });
  });

  it("nullableString idem", () => {
    expect(nullableString("d")).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "d",
    });
  });

  it("o detector realmente pega a forma proibida", () => {
    // Mutação de controle: sem isto, um detector quebrado passaria calado.
    const ruim = {
      type: "object",
      properties: { x: { type: ["string", "null"], enum: ["a", null] } },
    };
    expect(forbiddenUnions(ruim)).toEqual(["$.properties.x"]);
  });
});
