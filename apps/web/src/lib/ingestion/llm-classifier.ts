/**
 * Classificador de item por LLM — o PRIMEIRO ponto de julgamento da Fase A2.
 *
 * Implementa a interface `ItemClassifier` que a Fase A1 deixou pronta: o
 * executor não muda uma linha, o que troca é qual implementação o run recebe.
 *
 * ## O determinístico é insumo, não rascunho
 *
 * `precomputeItemSignals` roda ANTES e vai no prompt. Isso não é redundância:
 * o palpite determinístico lê o TÍTULO do instrumento e recorta os parágrafos
 * que de fato falam de garantia — é barato, é auditável e ancora o modelo em
 * vocabulário fechado em vez de deixá-lo inventar taxonomia.
 *
 * Quando os dois discordam, **o LLM prevalece** (ele leu o documento; a
 * heurística leu palavras-chave), mas a divergência é REGISTRADA em
 * `classification.conflicts` e o planner a transforma em issue
 * `classification_conflict`. Uma correção silenciosa seria indistinguível de um
 * acerto na tela de revisão.
 *
 * ## PII
 *
 * O modelo devolve só o que regex não pega — NOME e ENDEREÇO. Esses trechos
 * entram em `detectPii` como `externalEntities`, que os resolve por busca
 * literal (ver `resolveExternalEntities` em `lib/ingestion/pii.ts`). O módulo
 * de PII segue determinístico: o LLM aponta o quê, quem localiza é a busca.
 */

import {
  GARANTIA_TIPOS,
  isKnownModalidade,
  normalizeGarantiaTipo,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";
import { garantiaExcerpts } from "@/lib/templates/ingestion-triage";
import {
  INGEST_DOC_TYPES,
  ingestDocTypeDef,
  isIngestDocType,
  modalidadeForIngest,
  type IngestDocType,
} from "@/lib/templates/ingestion-types";
import { INGEST_CLASSIFY_MODEL } from "@/lib/ai/shared/models";
import {
  runStructured,
  type StructuredRunner,
} from "@/lib/ai/shared/anthropic-structured";
import { detectPii, type ExternalEntity } from "@/lib/ingestion/pii";
import {
  familyKey,
  precomputeItemSignals,
  summarizePii,
  type ClassifiedItem,
  type ClassifyItemInput,
  type ItemClassification,
  type ItemClassificationConflict,
  type ItemClassifier,
} from "@/lib/ingestion/classifier";
import type { IngestionAiMeter } from "@/lib/ingestion/ai-budget";

/**
 * Quanto do documento vai no prompt. Um contrato inteiro tem ~200k chars e a
 * decisão ("que documento é este? qual a garantia?") mora no título e na
 * cláusula de garantia — mandar o resto multiplicaria o custo do lote sem mudar
 * a resposta. O recorte de garantia é anexado à parte justamente porque a
 * cláusula costuma estar depois deste corte.
 */
export const MAX_CLASSIFY_HEAD_CHARS = 12_000;
export const MAX_CLASSIFY_GARANTIA_CHARS = 6_000;

/** Categorias que o LLM pode apontar — as duas que regex não alcança. */
const EXTERNAL_PII_KINDS = ["person_name", "address"] as const;
type ExternalPiiKind = (typeof EXTERNAL_PII_KINDS)[number];

/** Todas as sub-opções válidas, em qualquer tipo. Enum fechado no prompt. */
const SUB_OPTIONS = Array.from(
  new Set(
    INGEST_DOC_TYPES.flatMap((t) =>
      ingestDocTypeDef(t).subOptions.map((o) => o.value)
    )
  )
);

/** Modalidades alcançáveis pela ingestão — o enum de `modalidade` na saída. */
const MODALIDADES = Array.from(
  new Set(
    INGEST_DOC_TYPES.flatMap((t) => {
      const def = ingestDocTypeDef(t);
      return def.subOptions.length
        ? def.subOptions.map((o) => o.modalidade)
        : def.modalidade
          ? [def.modalidade]
          : [];
    })
  )
);

/** Resposta crua do modelo. Validada campo a campo antes de virar domínio. */
interface RawClassification {
  docType: string | null;
  subOption: string | null;
  modalidade: string | null;
  garantiaTipo: string | null;
  provider: string | null;
  isFilledInstance: boolean;
  piiEntities: Array<{ kind: string; excerpt: string }>;
  confidence: number;
  reason: string;
}

/** JSON Schema da saída — objeto fechado, enums nos valores canônicos. */
export const CLASSIFICATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "docType",
    "subOption",
    "modalidade",
    "garantiaTipo",
    "provider",
    "isFilledInstance",
    "piiEntities",
    "confidence",
    "reason",
  ],
  properties: {
    docType: {
      type: ["string", "null"],
      enum: [...INGEST_DOC_TYPES, null],
      description: "Tipo do documento na linguagem do usuário.",
    },
    subOption: {
      type: ["string", "null"],
      enum: [...SUB_OPTIONS, null],
      description: "Sub-opção do tipo. Null quando o tipo não tem sub-opção.",
    },
    modalidade: {
      type: ["string", "null"],
      enum: [...MODALIDADES, null],
      description: "Modalidade canônica de ContractTemplate.",
    },
    garantiaTipo: {
      type: ["string", "null"],
      enum: [...GARANTIA_TIPOS, null],
      description:
        "Garantia locatícia do documento. Null fora de locação/proposta de locação.",
    },
    provider: {
      type: ["string", "null"],
      description:
        'Rótulo humano do fornecedor da garantia ("Porto Seguro"). Null quando não há.',
    },
    isFilledInstance: {
      type: "boolean",
      description: "true se o documento traz dados reais de um cliente.",
    },
    piiEntities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "excerpt"],
        properties: {
          kind: { type: "string", enum: [...EXTERNAL_PII_KINDS] },
          excerpt: {
            type: "string",
            description: "Trecho LITERAL do documento, copiado sem alterar.",
          },
        },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: {
      type: "string",
      description: "Uma frase curta em PT-BR explicando a decisão.",
    },
  },
};

/**
 * Bloco ESTÁVEL do system prompt: taxonomia e regras. Vem primeiro e leva o
 * breakpoint de cache — os 20 documentos de um lote compartilham este prefixo
 * inteiro, e é isso que faz a classificação caber no alvo de custo.
 */
const CLASSIFY_PLAYBOOK = `Você classifica documentos do acervo de uma imobiliária brasileira, para uma
biblioteca de modelos de contrato. Responda SOMENTE com o JSON do schema.

## Vocabulário FECHADO

docType: ${INGEST_DOC_TYPES.join(" | ")}
subOption: ${SUB_OPTIONS.join(" | ")} (ou null)
modalidade: ${MODALIDADES.join(" | ")} (ou null)
garantiaTipo: ${GARANTIA_TIPOS.join(" | ")} (ou null)

Nunca invente valor fora dessas listas. Na dúvida entre dois, escolha o mais
provável e baixe a \`confidence\`.

## Como decidir o tipo

O TÍTULO do instrumento manda. "CONTRATO DE LOCAÇÃO" é contrato, por mais vezes
que a palavra "proposta" apareça nas cláusulas — contratos com seguro-fiança
citam "proposta de seguro" e "protocolo da proposta" o tempo todo. Só trate como
proposta o documento que se DECLARA oferta: valor ofertado, prazo de validade,
"proponente", e sem cláusula de rescisão nem fecho de assinaturas em duas vias.

\`clausulas\` é para o arquivo que NÃO é um contrato inteiro: um punhado de
cláusulas soltas para reusar. Nesse caso modalidade e garantia saem null.

## Como decidir a garantia

Olhe a cláusula que de fato constitui a garantia da locação:

- fiador — alguém assina "na condição de FIADOR e devedor solidário";
- caucao — depósito em dinheiro/bem dado em caução;
- seguro_fianca — apólice de fiança locatícia contratada junto a uma seguradora;
- titulo_capitalizacao — título de capitalização apresentado como garantia;
- garantia_onerosa — garantia prestada por empresa de garantia locatícia
  (Almada, Loft, CredAluga e afins), mediante taxa;
- propria — o próprio locatário oferece bem próprio;
- sem_garantia — o contrato declara que a locação não tem garantia.

ARMADILHA: todo contrato de locação tem uma cláusula de SEGURO CONTRA INCÊNDIO
que cita "apólice", "seguradora" e "sinistro". Ela NÃO é garantia locatícia e
aparece igual no contrato de fiador. Nunca decida \`seguro_fianca\` por ela.

Fora de locação e de proposta de locação, \`garantiaTipo\` é null — "fiador" no
meio de um contrato de compra e venda é ruído.

## provider

O nome da empresa que PRESTA a garantia, como um humano o escreveria: "Porto
Seguro", "Tokio Marine", "Pottencial", "TOO", "Almada", "Loft", "CredAluga". Não
slugifique, não abrevie, não invente. Banco financiador de compra e venda NÃO é
provider. Sem fornecedor identificado, null.

## piiEntities

Liste apenas NOMES DE PESSOA e ENDEREÇOS que aparecem no documento — CPF, CNPJ,
RG, telefone, e-mail e CEP já são detectados por outro mecanismo e não devem
entrar. Copie o trecho LITERAL, exatamente como está escrito no documento
(mesma grafia, mesma caixa), porque ele será localizado por busca literal. Não
inclua nomes de empresa, cartório, seguradora ou órgão público — só pessoas
físicas e endereços.

## isFilledInstance

true quando o documento traz dados reais preenchidos (partes nomeadas, CPF,
endereço do imóvel, valores). false quando é uma minuta em branco, com lacunas
ou tokens.`;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[…]`;
}

/** O que de fato viaja do documento: cabeça + os trechos de garantia. */
export function buildClassifyUserContent(input: ClassifyItemInput): string {
  const signals = precomputeItemSignals(input);
  const garantia = garantiaExcerpts(input.text)
    .flatMap((e) => e.paragraphs)
    .join("\n\n");

  return [
    `ARQUIVO: ${input.filename}`,
    `ESTRUTURA (classificador de upload): ${input.upload.kind} — ${input.upload.reason}`,
    "",
    "PALPITE DETERMINÍSTICO (confirme ou corrija; ele lê título e palavra-chave, não o documento):",
    `- docType: ${signals.docType ?? "null"}`,
    `- subOption: ${signals.subOption ?? "null"}`,
    `- modalidade: ${signals.modalidade ?? "null"}`,
    `- garantiaTipo: ${signals.garantiaTipo ?? "null"}`,
    `- porquê: ${signals.reason}`,
    "",
    garantia
      ? `TRECHOS QUE FALAM DE GARANTIA:\n${clip(garantia, MAX_CLASSIFY_GARANTIA_CHARS)}`
      : "TRECHOS QUE FALAM DE GARANTIA: nenhum encontrado.",
    "",
    `DOCUMENTO (início):\n${clip(input.text, MAX_CLASSIFY_HEAD_CHARS)}`,
  ].join("\n");
}

function asString(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
}

function toDocType(v: unknown): IngestDocType | null {
  return isIngestDocType(v) ? v : null;
}

function toGarantia(v: unknown): GarantiaTipo | null {
  return normalizeGarantiaTipo(v);
}

/** Entidades externas aceitáveis: categoria fechada e trecho não vazio. */
function toExternalEntities(raw: unknown): ExternalEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: ExternalEntity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const kind = (item as { kind?: unknown }).kind;
    const excerpt = asString((item as { excerpt?: unknown }).excerpt);
    if (!excerpt) continue;
    if (!(EXTERNAL_PII_KINDS as readonly string[]).includes(kind as string)) continue;
    out.push({ kind: kind as ExternalPiiKind, excerpt });
  }
  return out;
}

function conflictsBetween(
  heuristic: {
    docType: IngestDocType | null;
    subOption: string | null;
    modalidade: string | null;
    garantiaTipo: GarantiaTipo | null;
  },
  llm: {
    docType: IngestDocType | null;
    subOption: string | null;
    modalidade: string | null;
    garantiaTipo: GarantiaTipo | null;
  }
): ItemClassificationConflict[] {
  const fields = ["docType", "subOption", "modalidade", "garantiaTipo"] as const;
  const out: ItemClassificationConflict[] = [];
  for (const field of fields) {
    const a = heuristic[field] ?? null;
    const b = llm[field] ?? null;
    if (a !== b) out.push({ field, heuristic: a, llm: b });
  }
  return out;
}

/**
 * Modalidade final. A do LLM só é aceita quando é conhecida E compatível com o
 * tipo que ele mesmo escolheu; senão vale a derivada de `docType + subOption`,
 * que é uma função pura da taxonomia. Aceitar uma modalidade que o tipo não
 * admite criaria um item cuja família aponta para um formulário que não existe.
 */
function resolveModalidade(
  docType: IngestDocType | null,
  subOption: string | null,
  llmModalidade: string | null
): string | null {
  const derived = docType ? modalidadeForIngest(docType, subOption) : null;
  if (!llmModalidade || !isKnownModalidade(llmModalidade)) return derived;
  if (!docType) return null;
  const def = ingestDocTypeDef(docType);
  const allowed = def.subOptions.length
    ? def.subOptions.map((o) => o.modalidade)
    : def.modalidade
      ? [def.modalidade]
      : [];
  return allowed.includes(llmModalidade) ? llmModalidade : derived;
}

export interface LlmClassifierOptions {
  /** Injetável para o teste — em produção é `runStructured`. */
  structured?: StructuredRunner;
  /** Medidor de custo do run. Sem ele não há registro nem cap. */
  meter?: IngestionAiMeter;
  model?: string;
}

/**
 * Cria o classificador LLM. Ele NÃO faz fallback silencioso: uma falha da
 * chamada sobe, e é o executor (que já tem o caminho de fallback determinístico
 * em `classifyItem`) quem decide o que fazer com ela.
 */
export function createLlmItemClassifier(
  options: LlmClassifierOptions = {}
): ItemClassifier {
  const call = options.structured ?? runStructured;
  const model = options.model ?? INGEST_CLASSIFY_MODEL;

  return {
    name: "llm",
    async classify(input: ClassifyItemInput): Promise<ClassifiedItem> {
      const signals = precomputeItemSignals(input);
      options.meter?.assertWithinCap();

      const result = await call<RawClassification>({
        model,
        system: [{ text: CLASSIFY_PLAYBOOK, cache: true }],
        userContent: buildClassifyUserContent(input),
        schema: CLASSIFICATION_SCHEMA,
        maxTokens: 2_000,
        effort: "low",
      });

      if (options.meter) {
        await options.meter.record({
          operation: "ingest_classify",
          model: result.model,
          usage: result.usage,
          latencyMs: result.latencyMs,
        });
      }

      const raw = (result.data ?? {}) as Partial<RawClassification>;
      const docType = toDocType(raw.docType);
      const subOption = asString(raw.subOption);
      const modalidade = resolveModalidade(
        docType,
        subOption,
        asString(raw.modalidade)
      );
      // A garantia só é um EIXO onde o tipo admite o slot — a mesma guarda de
      // `precomputeItemSignals`. Sem ela, "fiador" citado num CCV viraria
      // família de garantia e o documento nunca agruparia com seus pares.
      const admitsGarantia = docType
        ? ingestDocTypeDef(docType).slots.includes("garantia")
        : false;
      const garantiaTipo = admitsGarantia ? toGarantia(raw.garantiaTipo) : null;

      const confidence =
        typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
          ? Math.min(1, Math.max(0, raw.confidence))
          : 0.5;

      const externalEntities = toExternalEntities(raw.piiEntities);
      const findings = detectPii(input.text, { externalEntities });

      const classification: ItemClassification = {
        via: "llm",
        docType,
        subOption,
        modalidade,
        garantiaTipo,
        familyKey: familyKey({ docType, modalidade, garantiaTipo }),
        uploadKind: input.upload.kind,
        confidence,
        reason: asString(raw.reason) ?? signals.reason,
        provider: asString(raw.provider),
        isFilledInstance: raw.isFilledInstance === true,
        conflicts: conflictsBetween(signals, {
          docType,
          subOption,
          modalidade,
          garantiaTipo,
        }),
      };

      // O `input.text` vai junto: é sobre ele que os offsets de nome/endereço
      // são calculados, e são esses offsets que mantêm os dois alcançáveis
      // depois — a contagem sozinha não localiza nada.
      return { classification, piiReport: summarizePii(findings, input.text) };
    },
  };
}
