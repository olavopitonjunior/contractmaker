/**
 * Verificador ESTRUTURAL de JSON Schema para `output_config.format`.
 *
 * ## Por que isto existe
 *
 * `output_config.format` aceita um SUBCONJUNTO de JSON Schema, e o subconjunto
 * não está documentado a contento: cada restrição apareceu como um HTTP 400 num
 * run real de staging, uma por deploy. Nenhum teste desta base chega na API —
 * logo, nada aqui pegaria a próxima sozinho. Este módulo é o substituto:
 * percorre o schema inteiro (inclusive `items`, `$defs`, `anyOf` e objetos
 * aninhados) e reprova ANTES do deploy.
 *
 * ## As restrições CONFIRMADAS, cada uma por um 400 de verdade
 *
 * **1. `enum` junto de `type` em união.**
 *
 * ```
 * Invalid schema: Enum value 'fiador' does not match declared type
 * '['string', 'null']'
 * ```
 *
 * `{ type: ["string","null"], enum: [...VALORES, null] }` é JSON Schema legal,
 * mas o validador checa cada valor do `enum` contra o `type` DECLARADO e não
 * destrincha a união: para ele `'fiador'` não é do tipo `['string','null']`. A
 * forma aceita mantém cada ramo consistente consigo mesmo:
 *
 * ```json
 * { "anyOf": [{ "type": "string", "enum": ["fiador"] }, { "type": "null" }] }
 * ```
 *
 * **2. Restrição de faixa em número.**
 *
 * ```
 * For 'number' type, properties maximum, minimum are not supported
 * request_id=req_011CeQ8FQZXmnA6G4i8QRffc
 * ```
 *
 * ## A leitura das duas, e o que ela prevê
 *
 * O subconjunto aceita o que descreve a FORMA da saída (`type`, `properties`,
 * `required`, `items`, `enum`, `anyOf`, `additionalProperties`, `description`)
 * e recusa o que restringe o VALOR além da forma. `minimum`/`maximum` são só o
 * primeiro membro dessa família a aparecer; `minLength`, `pattern`, `format`,
 * `minItems` e companhia são a mesma ideia em outro tipo, e não há motivo para
 * esperar que passem.
 *
 * Por isso {@link UNSUPPORTED_KEYWORDS} vai além do que a API já recusou
 * explicitamente. As entradas deduzidas estão marcadas como tal, e a mensagem
 * de cada issue diz de qual grupo ela vem — quem mexer aqui precisa distinguir
 * "a API recusou isto" de "a API provavelmente recusa isto". Reprovar
 * localmente algo que talvez passasse custa uma linha a menos no schema;
 * descobrir em produção custa um run.
 *
 * O que NÃO entra na lista: `description` (usadíssima, e o schema com ela
 * passou), `title`, `$defs`/`$ref` e os combinadores `anyOf`/`oneOf`/`allOf` —
 * `anyOf` está confirmado funcionando e chutar contra os irmãos dele quebraria
 * schema válido sem evidência nenhuma.
 *
 * Onde a restrição importa de verdade (a faixa de `confidence`, por exemplo),
 * ela sai do schema e vira validação no PARSE. Ver `toConfidence` em
 * `lib/ingestion/llm-classifier.ts` e em `lib/ingestion/planner.ts`.
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
  | "enum_type_mismatch"
  /** Palavra-chave de validação fora do subconjunto de `output_config.format`. */
  | "unsupported_keyword";

/**
 * Palavras-chave que o subconjunto não aceita → como a issue se explica.
 *
 * `confirmed` = a API já respondeu 400 por causa dela. `deduced` = mesma família
 * ("restringe o valor além da forma"), sem erro observado ainda. Ver o cabeçalho
 * do módulo para o raciocínio inteiro.
 */
export const UNSUPPORTED_KEYWORDS: Record<string, "confirmed" | "deduced"> = {
  // Confirmadas pelo 400 "For 'number' type, properties maximum, minimum are
  // not supported" (request_id=req_011CeQ8FQZXmnA6G4i8QRffc).
  minimum: "confirmed",
  maximum: "confirmed",

  // Faixa numérica — a MESMA família das duas acima.
  exclusiveMinimum: "deduced",
  exclusiveMaximum: "deduced",
  multipleOf: "deduced",

  // Restrição de valor em string.
  minLength: "deduced",
  maxLength: "deduced",
  pattern: "deduced",
  format: "deduced",
  contentEncoding: "deduced",
  contentMediaType: "deduced",

  // Restrição de valor em array.
  minItems: "deduced",
  maxItems: "deduced",
  uniqueItems: "deduced",
  contains: "deduced",
  minContains: "deduced",
  maxContains: "deduced",

  // Restrição de valor/estrutura condicional em objeto. `patternProperties` e
  // `propertyNames` dependem de `pattern`, que já cai na linha de cima.
  minProperties: "deduced",
  maxProperties: "deduced",
  patternProperties: "deduced",
  propertyNames: "deduced",
  dependentRequired: "deduced",
  dependentSchemas: "deduced",
  dependencies: "deduced",

  // Validação condicional e negação — não descrevem a forma da saída.
  if: "deduced",
  then: "deduced",
  else: "deduced",
  not: "deduced",
  unevaluatedProperties: "deduced",
  unevaluatedItems: "deduced",

  // Anotações que carregam um VALOR de exemplo/padrão. `default` está na lista
  // que a API recusa em outros produtos de structured output, e nenhuma delas
  // muda a forma da resposta — não vale o risco.
  default: "deduced",
  const: "deduced",
  examples: "deduced",
  readOnly: "deduced",
  writeOnly: "deduced",
  deprecated: "deduced",
};

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
  // Só as chaves DESTE nó de schema são palavras-chave. Os nomes dentro de
  // `properties` são dados do domínio — o planner tem um campo chamado `title`,
  // e confundi-lo com a anotação homônima seria um falso positivo garantido.
  for (const key of Object.keys(node)) {
    const origin = UNSUPPORTED_KEYWORDS[key];
    if (!origin) continue;
    out.push({
      path,
      rule: "unsupported_keyword",
      detail:
        origin === "confirmed"
          ? `\`${key}\` não é aceito por \`output_config.format\` — a API responde ` +
            "400. Se a restrição importa, mova-a para a validação no parse e " +
            "diga a faixa esperada na `description`."
          : `\`${key}\` restringe o valor além da forma; o subconjunto de ` +
            "`output_config.format` recusa essa família (o caso confirmado é " +
            "`minimum`/`maximum`). Tire do schema e valide no parse.",
    });
  }

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
