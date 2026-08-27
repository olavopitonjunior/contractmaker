import { describe, it, expect } from "vitest";
import {
  formatSchemaLintIssues,
  lintStructuredSchema,
  UNSUPPORTED_KEYWORDS,
} from "@/lib/ai/shared/schema-lint";

/**
 * Um objeto ESTRITO — todo campo em `required`, `additionalProperties: false`.
 *
 * Existe para os testes que não são sobre as regras de estrutura: sem ele, cada
 * fixture arrastaria duas issues de ruído e esconderia o que o teste quer ver.
 */
function strictObj(
  properties: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
    ...extra,
  };
}

describe("lintStructuredSchema — o padrão que derrubou o run", () => {
  it("reprova enum junto de type em união", () => {
    const issues = lintStructuredSchema(
      strictObj({
        garantia: { type: ["string", "null"], enum: ["fiador", "caucao", null] },
      })
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("enum_with_union_type");
    expect(issues[0].path).toBe("#/properties/garantia");
  });

  it("aprova a forma correta: anyOf com um ramo por tipo", () => {
    const issues = lintStructuredSchema(
      strictObj({
        garantia: {
          anyOf: [{ type: "string", enum: ["fiador", "caucao"] }, { type: "null" }],
        },
      })
    );
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

describe("lintStructuredSchema — palavras-chave fora do subconjunto", () => {
  it("reprova minimum/maximum em number — o segundo 400 real", () => {
    const issues = lintStructuredSchema(
      strictObj({ confidence: { type: "number", minimum: 0, maximum: 1 } })
    );

    expect(issues.map((i) => i.rule)).toEqual([
      "unsupported_keyword",
      "unsupported_keyword",
    ]);
    expect(issues.every((i) => i.path === "#/properties/confidence")).toBe(true);
    // A mensagem das confirmadas diz que a API responde 400, sem "provavelmente".
    expect(issues[0].detail).toContain("a API responde");
    expect(issues[0].detail).not.toContain("provavelmente");
  });

  it("aprova o número sem faixa, com a faixa dita na description", () => {
    expect(
      lintStructuredSchema({
        type: "number",
        description: "De 0 a 1. Fora dessa faixa o valor é truncado.",
      })
    ).toEqual([]);
  });

  it.each(Object.keys(UNSUPPORTED_KEYWORDS))("reprova `%s`", (keyword) => {
    const issues = lintStructuredSchema({ type: "string", [keyword]: 1 });
    expect(issues.map((i) => i.rule)).toEqual(["unsupported_keyword"]);
  });

  it("as deduzidas se anunciam como dedução, não como fato observado", () => {
    const [issue] = lintStructuredSchema({ type: "string", minLength: 3 });
    expect(issue.detail).toContain("recusa essa família");
    expect(issue.detail).toContain("`minimum`/`maximum`");
  });

  it("description, title e $defs seguem livres — não são restrição de valor", () => {
    expect(
      lintStructuredSchema(
        strictObj(
          { a: { type: "string", description: "Um campo." } },
          {
            title: "Plano",
            description: "O plano do lote.",
            $defs: { x: { type: "string" } },
          }
        )
      )
    ).toEqual([]);
  });

  it("anyOf/oneOf/allOf não são reprovados — anyOf está confirmado funcionando", () => {
    expect(
      lintStructuredSchema({ anyOf: [{ type: "string" }, { type: "null" }] })
    ).toEqual([]);
    expect(lintStructuredSchema({ oneOf: [{ type: "string" }] })).toEqual([]);
    expect(lintStructuredSchema({ allOf: [{ type: "string" }] })).toEqual([]);
  });

  it("um CAMPO chamado `title`, `default` ou `pattern` não é falso positivo", () => {
    // O planner tem uma propriedade `title`. Nome de campo em `properties` é
    // dado do domínio, não palavra-chave — confundi-los reprovaria schema bom.
    expect(
      lintStructuredSchema(
        strictObj({
          title: { type: "string" },
          default: { type: "string" },
          pattern: { type: "string" },
        })
      )
    ).toEqual([]);
  });

  it("a palavra-chave é achada em qualquer profundidade", () => {
    const issues = lintStructuredSchema(
      strictObj({
        lista: { type: "array", items: { type: "string", maxLength: 40 } },
        ramo: { anyOf: [{ type: "number", multipleOf: 0.5 }, { type: "null" }] },
      })
    );
    expect(issues.map((i) => i.path).sort()).toEqual([
      "#/properties/lista/items",
      "#/properties/ramo/anyOf/0",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Modo estrito — DEDUZIDO, nenhum 400 o citou ainda.
// ────────────────────────────────────────────────────────────────────────────

describe("lintStructuredSchema — todo campo em required", () => {
  it("reprova o campo de properties que ficou de fora", () => {
    const issues = lintStructuredSchema({
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { type: "string" }, b: { type: "string" } },
    });

    expect(issues.map((i) => i.rule)).toEqual(["incomplete_required"]);
    expect(issues[0].detail).toContain("b");
    expect(issues[0].detail).not.toContain(", a");
  });

  it("reprova o objeto sem `required` nenhum", () => {
    const issues = lintStructuredSchema({
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" } },
    });
    expect(issues.map((i) => i.rule)).toEqual(["incomplete_required"]);
  });

  it("a mensagem ensina a saída: manter em required e deixar a ausência ser valor", () => {
    const [issue] = lintStructuredSchema({
      type: "object",
      additionalProperties: false,
      properties: { opcional: { type: ["string", "null"] } },
    });
    expect(issue.detail).toContain("`null`");
    expect(issue.detail).toContain("como trata a omissão");
  });

  it("objeto de forma livre, sem properties, não gera issue", () => {
    // Não há campo a exigir; inventar issue aqui seria ruído.
    expect(lintStructuredSchema({ type: "object" })).toEqual([]);
    expect(
      lintStructuredSchema({ type: "object", additionalProperties: false })
    ).toEqual([]);
  });

  it("`required` completo passa, em qualquer ordem", () => {
    expect(
      lintStructuredSchema({
        type: "object",
        additionalProperties: false,
        required: ["b", "a"],
        properties: { a: { type: "string" }, b: { type: "string" } },
      })
    ).toEqual([]);
  });
});

describe("lintStructuredSchema — additionalProperties: false em todo objeto", () => {
  it("reprova o objeto sem additionalProperties", () => {
    const issues = lintStructuredSchema({
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" } },
    });
    expect(issues.map((i) => i.rule)).toEqual(["open_object"]);
    expect(issues[0].detail).toContain("ausente");
  });

  it("reprova `additionalProperties: true` — aberto é aberto", () => {
    const issues = lintStructuredSchema({
      type: "object",
      additionalProperties: true,
      required: ["a"],
      properties: { a: { type: "string" } },
    });
    expect(issues.map((i) => i.rule)).toEqual(["open_object"]);
    expect(issues[0].detail).toContain("true");
  });

  it("alcança objeto aninhado dentro de items", () => {
    const issues = lintStructuredSchema(
      strictObj({
        lista: {
          type: "array",
          items: { type: "object", properties: { x: { type: "string" } } },
        },
      })
    );
    expect(issues.map((i) => `${i.path} ${i.rule}`).sort()).toEqual([
      "#/properties/lista/items incomplete_required",
      "#/properties/lista/items open_object",
    ]);
  });
});

describe("lintStructuredSchema — a varredura alcança o schema inteiro", () => {
  it("desce por items, $defs, anyOf e objetos aninhados", () => {
    const issues = lintStructuredSchema(
      strictObj(
        {
          lista: {
            type: "array",
            items: strictObj({
              alvo: { type: ["string", "null"], enum: ["a", null] },
            }),
          },
          ramo: { anyOf: [{ type: "string", enum: ["ok", 1] }, { type: "null" }] },
        },
        { $defs: { reuso: { type: "string", enum: [null] } } }
      )
    );

    expect(issues.map((i) => i.path).sort()).toEqual([
      "#/$defs/reuso",
      "#/properties/lista/items/properties/alvo",
      "#/properties/ramo/anyOf/0",
    ]);
  });

  it("additionalProperties: false não é subschema e não quebra a varredura", () => {
    expect(lintStructuredSchema(strictObj({ a: { type: "string" } }))).toEqual([]);
  });

  it("entrada que não é objeto sai sem issue, em vez de lançar", () => {
    expect(lintStructuredSchema(null)).toEqual([]);
    expect(lintStructuredSchema("schema")).toEqual([]);
  });
});
