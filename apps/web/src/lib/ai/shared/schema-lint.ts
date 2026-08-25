/**
 * Verificador ESTRUTURAL de JSON Schema para `output_config.format`.
 *
 * ## Por que isto existe
 *
 * O primeiro run real em staging morreu com HTTP 400:
 *
 * ```
 * output_config.format.schema: Invalid schema:
 * Enum value 'fiador' does not match declared type '['string', 'null']'
 * ```
 *
 * O padrão `{ type: ["string", "null"], enum: [...VALORES, null] }` é JSON
 * Schema legal, mas o validador de structured outputs checa cada valor do `enum`
 * contra o `type` DECLARADO e não sabe destrinchar uma união: para ele
 * `'fiador'` não é do tipo `['string','null']`. A forma aceita mantém cada ramo
 * consistente consigo mesmo:
 *
 * ```json
 * { "anyOf": [{ "type": "string", "enum": ["fiador"] }, { "type": "null" }] }
 * ```
 *
 * Nenhum teste chama a API — logo, nada nesta base pegaria a regressão sozinho.
 * Este módulo é o substituto: percorre o schema inteiro (inclusive `items`,
 * `$defs`, `anyOf` e objetos aninhados) e reprova o descasamento ANTES do
 * deploy. Ver `__tests__/schema-lint.test.ts` e o teste que roda estas regras
 * sobre os schemas reais da ingestão.
 */

/** Um descasamento encontrado. `path` usa notação de JSON Pointer simplificada. */
export interface SchemaLintIssue {
  path: string;
  rule: SchemaLintRule;
  detail: string;
}

export type SchemaLintRule =
  /** `enum` declarado junto de um `type` em união (array). */
  | "enum_with_union_type"
  /** `enum` contém `null` mas o `type` declarado não alcança `null`. */
  | "null_enum_unreachable"
  /** Valor do `enum` incompatível com o `type` do mesmo nível. */
  | "enum_type_mismatch";

type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null"
  | "array"
  | "object";

const TYPE_PREDICATES: Record<JsonSchemaType, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  null: (v) => v === null,
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonSchemaType(value: unknown): value is JsonSchemaType {
  return typeof value === "string" && value in TYPE_PREDICATES;
}

/** Rótulo curto e legível de um valor de `enum`, para a mensagem do erro. */
function label(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `'${value}'`;
  return String(value);
}

/**
 * Palavras-chave cujo valor é, ele mesmo, um schema. `additionalProperties` só
 * entra quando é objeto — o `false` de schema fechado não é subschema.
 */
const SUBSCHEMA_KEYS = [
  "items",
  "additionalItems",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
] as const;

/** Palavras-chave cujo valor é um MAPA de nome → schema. */
const SUBSCHEMA_MAPS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
] as const;

/** Palavras-chave cujo valor é uma LISTA de schemas. */
const SUBSCHEMA_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;

function checkNode(
  node: Record<string, unknown>,
  path: string,
  out: SchemaLintIssue[]
): void {
  const rawEnum = node.enum;
  const rawType = node.type;

  if (Array.isArray(rawEnum) && rawType !== undefined) {
    if (Array.isArray(rawType)) {
      // (a) O caso que derrubou o run. A união é a causa: o validador da API não
      // distribui os valores do enum pelos ramos do `type`.
      out.push({
        path,
        rule: "enum_with_union_type",
        detail:
          `\`enum\` convive com \`type\` em união (${JSON.stringify(rawType)}). ` +
          "A API recusa: cada valor do enum é checado contra o type inteiro. " +
          "Use `anyOf` com um ramo por tipo, cada um com o seu próprio enum.",
      });
    } else if (isJsonSchemaType(rawType)) {
      const matches = TYPE_PREDICATES[rawType];
      for (const value of rawEnum) {
        if (matches(value)) continue;
        // (b) `null` no enum de um type que não é "null" é o descasamento mais
        // comum — vale mensagem própria, porque a correção é outra (tornar o
        // campo opcional ou abrir um ramo `{"type":"null"}` no `anyOf`).
        out.push(
          value === null
            ? {
                path,
                rule: "null_enum_unreachable",
                detail:
                  `\`enum\` inclui null, mas o \`type\` declarado é "${rawType}" ` +
                  "e não alcança null. Abra um ramo `{ type: \"null\" }` no `anyOf`.",
              }
            : {
                // (c) Qualquer outro descasamento valor × type do mesmo nível.
                path,
                rule: "enum_type_mismatch",
                detail:
                  `O valor ${label(value)} do \`enum\` não é do \`type\` ` +
                  `declarado ("${rawType}").`,
              }
        );
      }
    }
  }

  for (const key of SUBSCHEMA_KEYS) {
    const child = node[key];
    if (isRecord(child)) checkNode(child, `${path}/${key}`, out);
    // `items` como tupla (JSON Schema draft antigo) é uma lista de schemas.
    else if (Array.isArray(child)) {
      child.forEach((entry, i) => {
        if (isRecord(entry)) checkNode(entry, `${path}/${key}/${i}`, out);
      });
    }
  }

  for (const key of SUBSCHEMA_MAPS) {
    const map = node[key];
    if (!isRecord(map)) continue;
    for (const [name, child] of Object.entries(map)) {
      if (isRecord(child)) checkNode(child, `${path}/${key}/${name}`, out);
    }
  }

  for (const key of SUBSCHEMA_LISTS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    list.forEach((entry, i) => {
      if (isRecord(entry)) checkNode(entry, `${path}/${key}/${i}`, out);
    });
  }
}

/**
 * Percorre o schema inteiro e devolve os descasamentos encontrados. Lista vazia
 * = schema aceitável para `output_config.format`.
 */
export function lintStructuredSchema(schema: unknown, root = "#"): SchemaLintIssue[] {
  if (!isRecord(schema)) return [];
  const out: SchemaLintIssue[] = [];
  checkNode(schema, root, out);
  return out;
}

/** As issues em uma string só — o corpo da mensagem de falha de um teste. */
export function formatSchemaLintIssues(issues: readonly SchemaLintIssue[]): string {
  return issues.map((i) => `${i.path} [${i.rule}] ${i.detail}`).join("\n");
}
