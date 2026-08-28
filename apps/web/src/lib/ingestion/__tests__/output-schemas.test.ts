/**
 * A guarda de regressão dos 400 que o subconjunto de `output_config.format`
 * já nos cobrou em staging, um por deploy:
 *
 * ```
 * Invalid schema: Enum value 'fiador' does not match declared type
 * '['string', 'null']'
 *
 * For 'number' type, properties maximum, minimum are not supported
 * ```
 *
 * Nenhum teste desta base chega na API — então nenhum teste pegaria isso
 * sozinho. Aqui os schemas REAIS passam pelo verificador estrutural
 * (`lib/ai/shared/schema-lint.ts`), que é o que teria reprovado os dois antes
 * do deploy.
 */

import { describe, it, expect } from "vitest";
import {
  formatSchemaLintIssues,
  lintStructuredSchema,
  UNSUPPORTED_KEYWORDS,
} from "@/lib/ai/shared/schema-lint";
import * as llmClassifier from "@/lib/ingestion/llm-classifier";
import * as planner from "@/lib/ingestion/planner";
import * as reviewer from "@/lib/contract-review/reviewer";

/**
 * Os módulos inteiros são importados de propósito: a varredura por `*_SCHEMA`
 * abaixo faz um schema NOVO entrar na guarda sozinho, sem ninguém lembrar de
 * adicionar um caso aqui.
 */
const MODULES: Array<[string, Record<string, unknown>]> = [
  ["llm-classifier", llmClassifier as unknown as Record<string, unknown>],
  ["planner", planner as unknown as Record<string, unknown>],
  // Revisor pós-geração de contrato (Workstream B) — o REVIEW_OUTPUT_SCHEMA
  // pagou o próprio 400 em staging (maxItems, req_011CeUHW9zfUz84zouVdXdFY)
  // por não estar nesta guarda. Agora está.
  ["contract-review/reviewer", reviewer as unknown as Record<string, unknown>],
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
  it("a varredura encontra os schemas conhecidos", () => {
    expect(exportedSchemas().map(([name]) => name).sort()).toEqual([
      "contract-review/reviewer.REVIEW_OUTPUT_SCHEMA",
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

  it("nenhum schema real carrega palavra-chave de restrição de valor", () => {
    // Varredura independente do linter: se um `pattern` ou `minItems` voltar em
    // qualquer profundidade, este teste diz exatamente onde.
    const keywords = new Set(Object.keys(UNSUPPORTED_KEYWORDS));
    /** Chaves cujo valor é um MAPA nome→schema: os nomes ali são do domínio. */
    const NAME_MAPS = new Set(["properties", "$defs", "definitions"]);
    const found: string[] = [];

    /** `node` é sempre um nó de SCHEMA — nunca um mapa de nomes. */
    function walkSchema(node: unknown, path: string): void {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walkSchema(child, `${path}/${i}`));
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;

      for (const key of Object.keys(record)) {
        if (keywords.has(key)) found.push(`${path}/${key}`);
      }
      for (const [key, value] of Object.entries(record)) {
        if (!value || typeof value !== "object") continue;
        // O campo `title` do planner mora numa chave de `properties`. Descer
        // direto no mapa faria o nome do campo virar palavra-chave.
        if (NAME_MAPS.has(key)) {
          for (const [name, child] of Object.entries(value)) {
            walkSchema(child, `${path}/${key}/${name}`);
          }
        } else {
          walkSchema(value, `${path}/${key}`);
        }
      }
    }

    for (const [name, schema] of exportedSchemas()) walkSchema(schema, name);
    expect(found).toEqual([]);
  });

  it("confidence perdeu minimum/maximum e ganhou a faixa na description", () => {
    const nodes = [
      (llmClassifier.CLASSIFICATION_SCHEMA as {
        properties: { confidence: Record<string, unknown> };
      }).properties.confidence,
      (planner.PLAN_SCHEMA as {
        properties: { confidence: Record<string, unknown> };
      }).properties.confidence,
    ];

    for (const node of nodes) {
      expect(node.type).toBe("number");
      expect(node.minimum).toBeUndefined();
      expect(node.maximum).toBeUndefined();
      // O modelo lê a description — é lá que a faixa passou a viver.
      expect(String(node.description)).toContain("0");
      expect(String(node.description)).toContain("1");
    }
  });

  it("todo objeto dos schemas reais é estrito: required completo e fechado", () => {
    // Varredura independente do linter. Se um campo novo entrar em `properties`
    // e ninguém o puser em `required`, este teste diz onde.
    const NAME_MAPS = new Set(["properties", "$defs", "definitions"]);
    const found: string[] = [];

    function walkSchema(node: unknown, path: string): void {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walkSchema(child, `${path}/${i}`));
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const properties = record.properties;

      if (properties && typeof properties === "object") {
        const names = Object.keys(properties);
        const required = Array.isArray(record.required) ? record.required : [];
        const missing = names.filter((n) => !required.includes(n));
        if (missing.length) found.push(`${path} fora de required: ${missing.join(",")}`);
        if (record.additionalProperties !== false) {
          found.push(`${path} sem additionalProperties:false`);
        }
        // `required` apontando para campo inexistente é erro do outro lado.
        const orphan = required.filter((n) => !names.includes(n as string));
        if (orphan.length) found.push(`${path} required órfão: ${orphan.join(",")}`);
      }

      for (const [key, value] of Object.entries(record)) {
        if (!value || typeof value !== "object") continue;
        if (NAME_MAPS.has(key)) {
          for (const [name, child] of Object.entries(value)) {
            walkSchema(child, `${path}/${key}/${name}`);
          }
        } else {
          walkSchema(value, `${path}/${key}`);
        }
      }
    }

    for (const [name, schema] of exportedSchemas()) walkSchema(schema, name);
    expect(found).toEqual([]);
  });

  it("os campos antes opcionais do template entraram em required", () => {
    const node = (
      planner.PLAN_SCHEMA as {
        properties: {
          templates: { items: { required: string[]; properties: object } };
        };
      }
    ).properties.templates.items;

    for (const field of ["slotBlocks", "isDefaultSuggested", "groupId"]) {
      expect(node.required).toContain(field);
    }
    expect(node.required.sort()).toEqual(Object.keys(node.properties).sort());
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
