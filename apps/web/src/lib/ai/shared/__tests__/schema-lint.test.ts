import { describe, it, expect } from "vitest";
import {
  formatSchemaLintIssues,
  lintStructuredSchema,
} from "@/lib/ai/shared/schema-lint";

describe("lintStructuredSchema — o padrão que derrubou o run", () => {
  it("reprova enum junto de type em união", () => {
    const issues = lintStructuredSchema({
      type: "object",
      properties: {
        garantia: { type: ["string", "null"], enum: ["fiador", "caucao", null] },
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("enum_with_union_type");
    expect(issues[0].path).toBe("#/properties/garantia");
  });

  it("aprova a forma correta: anyOf com um ramo por tipo", () => {
    const issues = lintStructuredSchema({
      type: "object",
      properties: {
        garantia: {
          anyOf: [{ type: "string", enum: ["fiador", "caucao"] }, { type: "null" }],
        },
      },
    });
    expect(issues).toEqual([]);
  });
});

describe("lintStructuredSchema — enum × type do mesmo nível", () => {
  it("reprova null no enum de um type que não alcança null", () => {
    const issues = lintStructuredSchema({
      type: "string",
      enum: ["pf", "pj", null],
    });
    expect(issues.map((i) => i.rule)).toEqual(["null_enum_unreachable"]);
  });

  it("reprova qualquer outro valor incompatível com o type", () => {
    const issues = lintStructuredSchema({ type: "string", enum: ["pf", 7, true] });
    expect(issues.map((i) => i.rule)).toEqual([
      "enum_type_mismatch",
      "enum_type_mismatch",
    ]);
    expect(formatSchemaLintIssues(issues)).toContain("7");
  });

  it("distingue integer de number", () => {
    expect(lintStructuredSchema({ type: "integer", enum: [1, 2] })).toEqual([]);
    expect(lintStructuredSchema({ type: "integer", enum: [1, 2.5] })).toHaveLength(1);
    expect(lintStructuredSchema({ type: "number", enum: [1, 2.5] })).toEqual([]);
  });

  it("enum SEM type é legal — não há o que descasar", () => {
    expect(lintStructuredSchema({ enum: ["fiador", null] })).toEqual([]);
  });

  it("type sem enum é legal, inclusive em união", () => {
    expect(lintStructuredSchema({ type: ["string", "null"] })).toEqual([]);
  });
});

describe("lintStructuredSchema — a varredura alcança o schema inteiro", () => {
  it("desce por items, $defs, anyOf e objetos aninhados", () => {
    const issues = lintStructuredSchema({
      type: "object",
      properties: {
        lista: {
          type: "array",
          items: {
            type: "object",
            properties: {
              alvo: { type: ["string", "null"], enum: ["a", null] },
            },
          },
        },
        ramo: {
          anyOf: [{ type: "string", enum: ["ok", 1] }, { type: "null" }],
        },
      },
      $defs: {
        reuso: { type: "string", enum: [null] },
      },
    });

    expect(issues.map((i) => i.path).sort()).toEqual([
      "#/$defs/reuso",
      "#/properties/lista/items/properties/alvo",
      "#/properties/ramo/anyOf/0",
    ]);
  });

  it("additionalProperties: false não é subschema e não quebra a varredura", () => {
    expect(
      lintStructuredSchema({
        type: "object",
        additionalProperties: false,
        properties: { a: { type: "string" } },
      })
    ).toEqual([]);
  });

  it("entrada que não é objeto sai sem issue, em vez de lançar", () => {
    expect(lintStructuredSchema(null)).toEqual([]);
    expect(lintStructuredSchema("schema")).toEqual([]);
  });
});
