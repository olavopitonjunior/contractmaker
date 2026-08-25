/**
 * A guarda de regressão do 400 que derrubou o primeiro run em staging.
 *
 * ```
 * output_config.format.schema: Invalid schema:
 * Enum value 'fiador' does not match declared type '['string', 'null']'
 * ```
 *
 * Nenhum teste desta base chega na API — então nenhum teste pegaria isso
 * sozinho. Aqui os schemas REAIS de `output_config.format` passam pelo
 * verificador estrutural (`lib/ai/shared/schema-lint.ts`), que é o que teria
 * reprovado o schema antes do deploy.
 */

import { describe, it, expect } from "vitest";
import {
  formatSchemaLintIssues,
  lintStructuredSchema,
} from "@/lib/ai/shared/schema-lint";
import * as llmClassifier from "@/lib/ingestion/llm-classifier";
import * as planner from "@/lib/ingestion/planner";

/**
 * Os módulos inteiros são importados de propósito: a varredura por `*_SCHEMA`
 * abaixo faz um schema NOVO entrar na guarda sozinho, sem ninguém lembrar de
 * adicionar um caso aqui.
 */
const MODULES: Array<[string, Record<string, unknown>]> = [
  ["llm-classifier", llmClassifier as unknown as Record<string, unknown>],
  ["planner", planner as unknown as Record<string, unknown>],
];

function exportedSchemas(): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [moduleName, mod] of MODULES) {
    for (const [key, value] of Object.entries(mod)) {
      if (key.endsWith("SCHEMA")) out.push([`${moduleName}.${key}`, value]);
    }
  }
  return out;
}

describe("schemas de output_config.format", () => {
  it("a varredura encontra os dois schemas do caminho de ingestão", () => {
    expect(exportedSchemas().map(([name]) => name).sort()).toEqual([
      "llm-classifier.CLASSIFICATION_SCHEMA",
      "planner.PLAN_SCHEMA",
    ]);
  });

  it.each(exportedSchemas())("%s passa no verificador estrutural", (_name, schema) => {
    const issues = lintStructuredSchema(schema);
    expect(formatSchemaLintIssues(issues)).toBe("");
    expect(issues).toEqual([]);
  });

  it("os campos anuláveis usam anyOf, não type em união com enum", () => {
    const props = (
      llmClassifier.CLASSIFICATION_SCHEMA as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;

    for (const field of ["docType", "subOption", "modalidade", "garantiaTipo"]) {
      const node = props[field];
      expect(node.type, `${field} não pode declarar type no nível do anyOf`).toBeUndefined();
      const branches = node.anyOf as Array<Record<string, unknown>>;
      expect(branches).toHaveLength(2);
      expect(branches[0].type).toBe("string");
      expect(Array.isArray(branches[0].enum)).toBe(true);
      expect(branches[0].enum).not.toContain(null);
      expect(branches[1]).toEqual({ type: "null" });
    }
  });

  it("o enum de garantiaTipo continua sendo a taxonomia inteira", () => {
    const node = (
      llmClassifier.CLASSIFICATION_SCHEMA as {
        properties: { garantiaTipo: { anyOf: Array<{ enum?: string[] }> } };
      }
    ).properties.garantiaTipo;
    expect(node.anyOf[0].enum).toContain("fiador");
    expect(node.anyOf[0].enum).toContain("seguro_fianca");
  });

  it("matchCriteria do planner também saiu da união", () => {
    const criteria = (
      planner.PLAN_SCHEMA as {
        properties: {
          templates: {
            items: {
              properties: {
                matchCriteria: { properties: Record<string, Record<string, unknown>> };
              };
            };
          };
        };
      }
    ).properties.templates.items.properties.matchCriteria.properties;

    for (const field of ["garantia", "fiadorPessoa", "pessoa"]) {
      expect(criteria[field].type).toBeUndefined();
      expect(criteria[field].anyOf).toBeTruthy();
    }
    // Campo anulável SEM vocabulário fechado pode seguir na união: o que a API
    // recusa é enum + união, não a união sozinha.
    expect(criteria.admImobiliaria).toEqual({ type: ["boolean", "null"] });
  });
});
