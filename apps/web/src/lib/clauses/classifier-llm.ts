/**
 * Camada de LLM do classificador de cláusulas.
 *
 * Espelha `lib/ingestion/llm-classifier.ts`: JSON Schema fechado, prompt em
 * blocos cacheáveis, e todo o julgamento do modelo passando por guardrails
 * determinísticos em `lib/clauses/classify.ts` antes de virar proposta.
 *
 * O prefixo cacheável (playbook + vocabulário + eixos) é IDÊNTICO entre as
 * cláusulas de um mesmo lote — é o que faz um lote de 25 custar pouco mais que
 * uma chamada só.
 */
import {
  runStructured,
  nullableEnum,
  nullableString,
  type StructuredRunner,
  type SystemBlock,
} from "@/lib/ai/shared/anthropic-structured";
import { CLAUSE_CLASSIFY_MODEL } from "@/lib/ai/shared/models";
import { recordAIUsage } from "@/lib/ai/usage";
import {
  buildProposal,
  type ClauseSnapshot,
  type ClauseClassificationProposal,
  type RawClassification,
} from "@/lib/clauses/classify";
import {
  validateKey,
  applyMapping,
  assertRendered,
  buildKeyCatalog,
} from "@/lib/clauses/key-catalog";
import {
  DESCRIPTIVE_VOCABULARY,
  descriptiveVocabularyFor,
} from "@/lib/clauses/tag-vocabulary";
import {
  ESTEIRA_AXIS,
  CLAUSE_ESTEIRAS,
  esteiraForModalidade,
} from "@/lib/clauses/taxonomy";
import {
  CLAUSE_SUBCATEGORY_SUGGESTIONS,
  CLAUSE_GROUP_CODES,
} from "@/lib/clauses/schema";
import type { FormModule } from "@/lib/forms/presets";

/** Corte do conteúdo enviado ao modelo. Cláusula é curta; texto gigante é anomalia. */
const MAX_CONTENT_CHARS = 6_000;

/** Schema FECHADO — `additionalProperties: false` em todo nível. */
export const CLAUSE_CLASSIFICATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["esteira", "subcategory", "tags", "agentNotes", "mappings", "reason"],
  properties: {
    // `nullableEnum`, e NÃO `{type:["string","null"], enum:[...,null]}` — este
    // segundo formato é recusado com 400 pelo validador de `output_config`
    // (o helper carrega o porquê). Custou um smoke em staging pra reaprender.
    esteira: nullableEnum(
      CLAUSE_ESTEIRAS,
      "A que esteira a cláusula pertence. 'ambas' só para cláusula genuinamente comum (foro, assinatura eletrônica, LGPD). null se não der para decidir pelo texto."
    ),
    groupCode: nullableEnum(
      CLAUSE_GROUP_CODES,
      "SÓ quando esteira='venda'. Em locação, sempre null — grupos G1–G6 não existem lá."
    ),
    subcategory: nullableString(
      "Um valor da lista de temas fornecida para a esteira escolhida."
    ),
    tags: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
      description:
        "Somente tags do vocabulário fornecido. NUNCA use os prefixos slot:, garantia:, provider: ou cobertura:.",
    },
    agentNotes: nullableString(
      "Em PT-BR, no máximo 3 frases, dizendo QUANDO o agente deve usar esta cláusula."
    ),
    mappings: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["trecho", "chave"],
        properties: {
          trecho: {
            type: "string",
            description:
              "Cópia EXATA e ÚNICA de um trecho do texto atual (um valor literal), sem reescrever nada.",
          },
          chave: {
            type: "string",
            description: "Caminho do catálogo fornecido, sem chaves duplas.",
          },
        },
      },
      description:
        "Valores literais que deveriam virar variáveis. Lista vazia quando não há o que tokenizar.",
    },
    reason: {
      type: "string",
      description: "Uma linha em PT-BR justificando a classificação.",
    },
  },
};

const PLAYBOOK = `Você classifica CLÁUSULAS de contratos imobiliários brasileiros para o acervo de uma imobiliária.

Recebe UMA cláusula já cadastrada e devolve os metadados que faltam, para que ela fique no mesmo padrão das cláusulas curadas do acervo.

## A decisão mais importante: a ESTEIRA

- "venda" — compra e venda de imóvel (CCV): arras/sinal, imissão na posse, escritura, registro, financiamento bancário, FGTS, comissão de corretagem na venda.
- "locacao" — locação regida pela Lei 8.245/91: aluguel, garantia locatícia (fiador, caução, seguro-fiança), reajuste, vistoria, benfeitorias, devolução do imóvel, renovatória, preferência.
- "ambas" — SÓ para cláusula genuinamente neutra quanto ao tipo de negócio: foro, assinatura eletrônica, proteção de dados, disposições gerais. Não use "ambas" por dúvida; use null.
- null — o texto não permite decidir.

Armadilhas conhecidas:
- "Rescisão" e "multa" existem nas DUAS esteiras. Decida pelo resto do texto (fala em aluguel? é locação; fala em sinal/arras? é venda), não pela palavra isolada.
- "Garantia" em locação é garantia LOCATÍCIA (art. 37). Em venda, "garantia" costuma ser outra coisa. Leia o contexto.
- Menção à Lei 8.245/91 é sinal forte de locação. Menção ao art. 417 do Código Civil (arras) é sinal forte de venda.

## groupCode

Os grupos G1–G6 são o roteiro de um contrato de COMPRA E VENDA. Só preencha quando esteira="venda"; caso contrário devolva null.

## Tokenização (mappings)

Aponte valores LITERAIS que deveriam ser variáveis — prazos, percentuais, número de meses, índices.

Regras rígidas:
1. NUNCA reescreva o texto. Devolva só pares {trecho, chave}.
2. "trecho" é cópia EXATA de algo que aparece no texto, e precisa ser ÚNICO nele. Se o valor aparece duas vezes, inclua palavras vizinhas suficientes para o trecho ficar único — ou não proponha.
3. "chave" só pode sair do catálogo fornecido. Não invente caminho.
4. Na dúvida, devolva menos. Uma tokenização errada corrompe contrato; uma faltando só dá trabalho manual.

## Tags

Use apenas o vocabulário fornecido. Jamais proponha tags com os prefixos slot:, garantia:, provider: ou cobertura: — elas ligam o formulário ao contrato e são gerenciadas por outro processo.`;

function axisBlock(): string {
  const venda = ESTEIRA_AXIS.venda.groups
    .map((g) => `  - ${g.code}: ${g.label}${g.help ? ` (${g.help})` : ""}`)
    .join("\n");
  const locacao = ESTEIRA_AXIS.locacao.groups
    .map((g) => `  - ${g.code}: ${g.label}`)
    .join("\n");
  return [
    "## Temas por esteira (valores válidos de subcategory)",
    "",
    "Esteira venda — use o groupCode correspondente e um destes temas gerais:",
    venda,
    `  Temas gerais aceitos: ${CLAUSE_SUBCATEGORY_SUGGESTIONS.join(", ")}`,
    "",
    "Esteira locacao — NÃO use groupCode. Temas:",
    locacao,
  ].join("\n");
}

function vocabularyBlock(): string {
  const lines = DESCRIPTIVE_VOCABULARY.map(
    (d) => `  - ${d.tag} — ${d.label} [${d.esteiras.join("/")}]`
  ).join("\n");
  return `## Vocabulário de tags (o único permitido)\n${lines}`;
}

/**
 * Blocos de system CACHEÁVEIS — iguais para todas as cláusulas do lote, e é
 * isso que barateia o lote. O que varia por cláusula vai no turno do usuário.
 */
export function buildSystemBlocks(): SystemBlock[] {
  return [
    { text: PLAYBOOK },
    { text: axisBlock() },
    { text: vocabularyBlock(), cache: true },
  ];
}

/** Catálogo de chaves oferecido ao modelo, recortado pela esteira provável. */
function keyCatalogBlock(esteiras: FormModule[]): string {
  const paths = new Set<string>();
  for (const e of esteiras) {
    const { primary, conditional } = buildKeyCatalog(e);
    for (const p of primary) paths.add(p);
    for (const p of conditional) paths.add(p);
  }
  // Caminhos-folha curtos primeiro; a lista completa é longa demais e o modelo
  // não precisa dos ramos intermediários para escolher.
  const list = [...paths].sort().slice(0, 400);
  return `## Catálogo de chaves permitidas\n${list.map((p) => `  - ${p}`).join("\n")}`;
}

export function buildUserContent(
  clause: ClauseSnapshot,
  esteiras: FormModule[]
): string {
  const content =
    clause.content.length > MAX_CONTENT_CHARS
      ? `${clause.content.slice(0, MAX_CONTENT_CHARS)}\n[…texto truncado…]`
      : clause.content;

  const frozenNote = clause.tags.length
    ? `\nTags atuais: ${clause.tags.join(", ")}`
    : "\nTags atuais: (nenhuma)";

  return [
    keyCatalogBlock(esteiras),
    "",
    "## Cláusula a classificar",
    `Título: ${clause.title}`,
    `Esteira atual: ${clause.esteira ?? "(não classificada)"}`,
    `Tema atual: ${clause.subcategory ?? "(nenhum)"}`,
    frozenNote,
    "",
    "Texto:",
    content,
  ].join("\n");
}

export interface ClassifyOneInput {
  clause: ClauseSnapshot;
  orgId: string;
  userId?: string | null;
  /** Injetável pro teste — default é o cliente real. */
  runner?: StructuredRunner;
  /** Detector de PII; só gera aviso. */
  detectPii?: (content: string) => string[];
}

export interface ClassifyOneResult {
  proposal: ClauseClassificationProposal | null;
  costModel: string;
}

/**
 * Classifica UMA cláusula. Erros sobem para o chamador tratar por item — um
 * lote não pode morrer inteiro porque uma cláusula falhou.
 */
export async function classifyOneClause(
  input: ClassifyOneInput
): Promise<ClassifyOneResult> {
  const { clause, orgId, userId } = input;
  const run = input.runner ?? runStructured;

  // Esteira provável só para escolher o catálogo de chaves oferecido: se a
  // cláusula ainda não tem esteira, oferecemos as duas e o modelo decide.
  const hint =
    clause.esteira === "venda" || clause.esteira === "locacao"
      ? [clause.esteira as FormModule]
      : (["venda", "locacao"] as FormModule[]);

  const t0 = Date.now();
  try {
    const result = await run<RawClassification>({
      model: CLAUSE_CLASSIFY_MODEL,
      system: buildSystemBlocks(),
      userContent: buildUserContent(clause, hint),
      schema: CLAUSE_CLASSIFICATION_SCHEMA,
      maxTokens: 2_000,
      effort: "medium",
    });

    recordAIUsage({
      orgId,
      userId: userId ?? null,
      agentKey: "curator",
      provider: "anthropic",
      model: result.model,
      operation: "clause_classify",
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      latencyMs: result.latencyMs,
      success: true,
    });

    const proposal = buildProposal(clause, result.data ?? {}, {
      validateKey,
      applyMapping,
      assertRendered,
      detectPii: input.detectPii,
    });

    return { proposal, costModel: result.model };
  } catch (err) {
    recordAIUsage({
      orgId,
      userId: userId ?? null,
      agentKey: "curator",
      provider: "anthropic",
      model: CLAUSE_CLASSIFY_MODEL,
      operation: "clause_classify",
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Reexport pra tela poder montar o autocomplete com o mesmo recorte do prompt. */
export { descriptiveVocabularyFor, esteiraForModalidade };
