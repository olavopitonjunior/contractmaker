/**
 * Planner — o SEGUNDO ponto de julgamento da Fase A2.
 *
 * A pergunta que ele responde é a que nenhum documento sozinho responde:
 * "olhando o LOTE INTEIRO, o que vira template e o que vira cláusula?". Uma
 * chamada, com o digest do lote, e a saída é o `LibraryPlan` do contrato.
 *
 * ## Por que REFERÊNCIAS de bloco e não texto
 *
 * O plano precisa carregar parágrafos LITERAIS do documento (`slotBlocks` só
 * funciona se bater byte a byte; o `content` da cláusula é o que vira embedding).
 * Mas o digest trunca as células da matriz de divergência em ~600 caracteres —
 * sem isso um lote de 20 contratos não caberia num prompt honesto.
 *
 * Pedir ao modelo que REPRODUZA um parágrafo que ele viu truncado é pedir que
 * ele alucine o resto. Então ele não reproduz: cada parágrafo divergente recebe
 * uma referência estável (`B12`) e o modelo devolve REFERÊNCIAS. Quem
 * materializa o texto é este módulo, a partir do índice — o parágrafo que entra
 * no plano é, por construção, o parágrafo que está no documento.
 *
 * Pelo mesmo motivo as TAGS da cláusula são derivadas aqui (`slotTagsFor` +
 * `providerTag`) e não pedidas ao modelo, e o `content` passa por `sanitizePii`
 * determinístico antes de entrar no plano. O modelo decide O QUE vira cláusula;
 * a redação exata e a limpeza são código.
 *
 * ## Escalação
 *
 * Plano inválido duas vezes, ou confiança abaixo de {@link MIN_PLAN_CONFIDENCE},
 * sobe um degrau da escada (`ladder`, em `planLibrary`). A primeira escalação NÃO troca de
 * modelo: sobe o `effort` de `high` para `xhigh` no mesmo Opus 4.8. Opus 4.8 e
 * Opus 5 custam o mesmo por token, então mais profundidade sai mais barato que
 * outro modelo (menos tokens gerados do zero) e o comportamento continua
 * previsível. Só quando nem o `xhigh` resolve é que o Opus 5 entra.
 *
 * Persistindo, o run NÃO é executado: o plano volta com `accepted: false` e as
 * issues explicando, para a revisão humana decidir. Um plano recusado custa
 * revisão a mais; um plano consertado em silêncio custa uma biblioteca errada.
 */

import { GARANTIA_TIPOS } from "@/lib/contracts/template-category";
import { DEFAULT_GARANTIA_OPTIONS } from "@/lib/forms/garantia-catalog";
import {
  providerTag,
  slotTagsFor,
  type ClauseSlotKey,
} from "@/lib/templates/clause-slots";
import {
  buildConsolidationPlan,
  buildDifferenceMatrix,
  normalizeDoc,
  paragraphKey,
  primaryDifferenceRow,
  toParagraphs,
} from "@/lib/templates/consolidation";
import { garantiaExcerpts } from "@/lib/templates/ingestion-triage";
import {
  INGEST_ESCALATION_MODEL,
  INGEST_PLAN_MODEL,
} from "@/lib/ai/shared/models";
import {
  runStructured,
  type EffortLevel,
  type StructuredRunner,
} from "@/lib/ai/shared/anthropic-structured";
import { sanitizePii, type ExternalEntity } from "@/lib/ingestion/pii";
import {
  externalPiiEntities,
  type ItemClassification,
  type ItemPiiReport,
} from "@/lib/ingestion/classifier";
import type {
  ConsolidationCandidate,
  GroupingReport,
} from "@/lib/ingestion/grouping";
import {
  LIBRARY_PLAN_VERSION,
  type LibraryPlan,
  type PlanDiscardReason,
  type PlanIssue,
  type PlanIssueKind,
  type PlannedClause,
  type PlannedMatchCriteria,
  type PlannedTemplate,
} from "@/lib/ingestion/library-plan";
import {
  validateLibraryPlan,
  type PlanGuardItem,
  type PlanViolation,
} from "@/lib/ingestion/plan-guardrails";
import { playbooksForModalidades } from "@/lib/ingestion/playbooks";
import type { IngestionAiMeter } from "@/lib/ingestion/ai-budget";

/** Abaixo disso o planner não confia na própria decisão — sobe um degrau. */
export const MIN_PLAN_CONFIDENCE = 0.6;

/** Um degrau da escalação: qual modelo, com quanta profundidade. */
export interface PlanStep {
  model: string;
  effort: EffortLevel;
}

/**
 * Índice do degrau em que a PROFUNDIDADE sobe. Confiança baixa pula direto para
 * cá: repetir a mesma pergunta com a mesma profundidade não muda a resposta, e
 * não há violação a devolver como feedback.
 */
const DEPTH_STEP_INDEX = 2;

/** Teto por célula da matriz de divergência levada ao prompt. */
export const MAX_DIGEST_CELL_CHARS = 600;

/** Teto de blocos indexados — um lote patológico não pode estourar o contexto. */
export const MAX_INDEXED_BLOCKS = 200;

/**
 * Linhas da matriz de divergência levadas por grupo. Um grupo real diverge em
 * dois ou três lugares (a cláusula de garantia, a qualificação das partes, a
 * numeração); dezenas de linhas seriam ruído de OCR, não estrutura.
 */
export const MAX_DIFFERENCE_ROWS_PER_GROUP = 12;

// ────────────────────────────────────────────────────────────────────────────
// Entradas
// ────────────────────────────────────────────────────────────────────────────

export interface PlannerItem {
  id: string;
  filename: string;
  text: string;
  /** `IngestionItem.status`; `discarded` mantém o item fora de fonte de plano. */
  status?: string;
  classification: ItemClassification | null;
  /**
   * `IngestionItem.piiReport`. É dele que saem os offsets de nome e endereço —
   * sem ele a cláusula deste item sai do planner sem essas duas categorias
   * tratadas e o executor a barra.
   */
  piiReport?: ItemPiiReport | null;
}

export interface PlanLibraryInput {
  items: readonly PlannerItem[];
  grouping: GroupingReport;
}

export interface PlanLibraryOptions {
  structured?: StructuredRunner;
  meter?: IngestionAiMeter;
  planModel?: string;
  escalationModel?: string;
}

export interface PlanAttemptRecord {
  attempt: number;
  model: string;
  effort: EffortLevel;
  ok: boolean;
  confidence: number;
  violations: PlanViolation[];
  /** Quanto a chamada demorou. Ver o `latencyMs` de `runStructured`. */
  durationMs: number;
}

export interface PlanLibraryResult {
  plan: LibraryPlan;
  /** Passou nos guardrails E na confiança mínima. */
  accepted: boolean;
  attempts: PlanAttemptRecord[];
  escalated: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Análise do lote: índice de blocos + matriz de divergência
// ────────────────────────────────────────────────────────────────────────────

export interface IndexedBlock {
  ref: string;
  itemId: string;
  text: string;
}

export interface BlockIndex {
  byRef: Map<string, IndexedBlock>;
  /** Blocos por item, na ordem em que foram indexados. */
  byItem: Map<string, IndexedBlock[]>;
}

export interface DifferenceRowView {
  anchorIndex: number;
  /** É a MAIOR divergência do grupo — a candidata natural a slot. */
  primary: boolean;
  cells: Array<{ itemId: string; blocks: IndexedBlock[] }>;
}

export interface GroupDifference {
  group: ConsolidationCandidate;
  /** Parágrafos idênticos entre TODOS os membros. */
  commonParagraphCount: number;
  /** Primeiro parágrafo da base comum — só para o planner reconhecer o texto. */
  commonPreview: string;
  rows: DifferenceRowView[];
}

export interface BatchAnalysis {
  index: BlockIndex;
  groups: GroupDifference[];
  singles: PlannerItem[];
}

class BlockRegistry implements BlockIndex {
  readonly byRef = new Map<string, IndexedBlock>();
  readonly byItem = new Map<string, IndexedBlock[]>();
  private readonly seen = new Map<string, IndexedBlock>();
  private n = 0;

  push(itemId: string, text: string): IndexedBlock | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const dedupe = `${itemId}\u0000${paragraphKey(trimmed)}`;
    const existing = this.seen.get(dedupe);
    if (existing) return existing;
    if (this.byRef.size >= MAX_INDEXED_BLOCKS) return null;

    this.n += 1;
    const block: IndexedBlock = { ref: `B${this.n}`, itemId, text: trimmed };
    this.seen.set(dedupe, block);
    this.byRef.set(block.ref, block);
    const list = this.byItem.get(itemId);
    if (list) list.push(block);
    else this.byItem.set(itemId, [block]);
    return block;
  }
}

/**
 * Analisa o lote e indexa TODO parágrafo que o plano pode citar.
 *
 * A matriz de divergência é RECALCULADA aqui em vez de reusar
 * `GroupingReport.groups[].primary`. O relatório do agrupamento guarda só a
 * MAIOR divergência, e no corpus real da Ativa essa maior divergência é a
 * cláusula de PINTURA INTERNA — que cita a seguradora de passagem e é longa —,
 * não a cláusula de fiança locatícia, que é justamente a que precisa virar
 * cláusula do acervo. Um índice construído só sobre a linha primária deixaria o
 * planner sem como referenciar o trecho certo, e ele "resolveria" o problema
 * escrevendo o parágrafo de memória.
 *
 * Documentos que não agruparam entram pelos trechos que falam de garantia: um
 * seguro-fiança sozinho no lote também precisa ter a cláusula dele disponível.
 */
export function analyzeBatch(input: PlanLibraryInput): BatchAnalysis {
  const registry = new BlockRegistry();
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const groups: GroupDifference[] = [];

  for (const candidate of input.grouping.groups) {
    const docs = candidate.memberIds
      .map((id) => byId.get(id))
      .filter((i): i is PlannerItem => Boolean(i))
      .map((i) =>
        normalizeDoc({
          id: i.id,
          name: i.filename,
          text: i.text,
          family: candidate.familyKey,
        })
      );
    if (docs.length < 2) continue;

    const consolidation = buildConsolidationPlan(docs);
    const matrix = buildDifferenceMatrix(consolidation);
    const primaryAnchor = primaryDifferenceRow(matrix)?.anchorIndex ?? null;

    const rows: DifferenceRowView[] = [];
    for (const row of matrix.slice(0, MAX_DIFFERENCE_ROWS_PER_GROUP)) {
      const cells = Object.entries(row.byDoc)
        .map(([itemId, paragraphs]) => ({
          itemId,
          blocks: paragraphs
            .map((p) => registry.push(itemId, p))
            .filter((b): b is IndexedBlock => Boolean(b)),
        }))
        .filter((cell) => cell.blocks.length > 0);
      if (cells.length === 0) continue;
      rows.push({
        anchorIndex: row.anchorIndex,
        primary: row.anchorIndex === primaryAnchor,
        cells,
      });
    }

    groups.push({
      group: candidate,
      commonParagraphCount: consolidation.commonParagraphs.length,
      commonPreview: clip(consolidation.commonParagraphs[0] ?? "", MAX_DIGEST_CELL_CHARS),
      rows,
    });
  }

  const grouped = new Set(input.grouping.groups.flatMap((g) => g.memberIds));
  const singles = input.items.filter((i) => !grouped.has(i.id));
  for (const item of singles) {
    for (const excerpt of garantiaExcerpts(item.text)) {
      for (const p of excerpt.paragraphs) registry.push(item.id, p);
    }
  }

  return { index: registry, groups, singles };
}

// ────────────────────────────────────────────────────────────────────────────
// Digest do lote
// ────────────────────────────────────────────────────────────────────────────

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function describeItem(item: PlannerItem): string {
  const c = item.classification;
  const parts = [
    `- [${item.id}] ${item.filename}`,
    `  tipo=${c?.docType ?? "?"} modalidade=${c?.modalidade ?? "?"} garantia=${c?.garantiaTipo ?? "?"}`,
    `  fornecedor=${c?.provider ?? "—"} preenchido=${c?.isFilledInstance ? "sim" : "não"}` +
      ` confiança=${(c?.confidence ?? 0).toFixed(2)} decidido_por=${c?.via ?? "?"}`,
    `  porquê: ${c?.reason ?? "—"}`,
  ];
  if (c?.conflicts?.length) {
    parts.push(
      `  divergência heurística×LLM: ` +
        c.conflicts
          .map((x) => `${x.field} (heurística=${x.heuristic ?? "null"} → llm=${x.llm ?? "null"})`)
          .join("; ")
    );
  }
  if (item.status === "discarded") parts.push("  ATENÇÃO: item já descartado.");
  return parts.join("\n");
}

/**
 * O digest do lote — classificações, matriz de agrupamento e o índice de blocos.
 * É o único conteúdo VOLÁTIL da chamada e por isso vai no turno do usuário,
 * depois do breakpoint de cache do system.
 */
export function buildBatchDigest(
  input: PlanLibraryInput,
  analysis: BatchAnalysis
): string {
  const lines: string[] = [];

  lines.push(`## DOCUMENTOS DO LOTE (${input.items.length})`, "");
  for (const item of input.items) lines.push(describeItem(item));

  lines.push("", "## FAMÍLIAS (docType:modalidade:garantia)", "");
  for (const family of input.grouping.families) {
    lines.push(`- ${family.familyKey}: ${family.itemIds.join(", ")}`);
  }

  lines.push("", "## GRUPOS QUASE IDÊNTICOS (candidatos a consolidação)", "");
  if (analysis.groups.length === 0) {
    lines.push("(nenhum — nenhum par do lote passou nos limiares de similaridade)");
  }
  for (const { group, commonParagraphCount, commonPreview, rows } of analysis.groups) {
    lines.push(
      "",
      `### grupo ${group.id} — família ${group.familyKey}`,
      `- membros: ${group.memberIds.join(", ")}`,
      `- Dice mínimo: ${group.minSimilarity.toFixed(3)} · contenção mínima: ` +
        `${group.minContainment.toFixed(3)} · ligados por: ${group.linkedBy}`,
      `- documento de referência: ${group.referenceItemId}`,
      `- base comum: ${commonParagraphCount} parágrafos idênticos entre TODOS os membros`,
      `- base comum começa com: ${commonPreview}`
    );
    if (rows.length === 0) {
      lines.push("- divergências: nenhuma (os membros são cópias exatas)");
      continue;
    }
    lines.push("- onde os membros divergem:");
    for (const row of rows) {
      lines.push(
        `  · posição ${row.anchorIndex}${row.primary ? " (MAIOR divergência)" : ""}:`
      );
      for (const cell of row.cells) {
        lines.push(`    [${cell.itemId}]`);
        for (const block of cell.blocks) {
          lines.push(`      ${block.ref}: ${clip(block.text, MAX_DIGEST_CELL_CHARS)}`);
        }
      }
    }
  }

  lines.push("", "## DOCUMENTOS QUE NÃO AGRUPARAM COM NINGUÉM", "");
  if (analysis.singles.length === 0) lines.push("(nenhum)");
  for (const item of analysis.singles) {
    lines.push(`- [${item.id}] ${item.filename}`);
    const blocks = analysis.index.byItem.get(item.id) ?? [];
    if (blocks.length === 0) lines.push("    (sem trecho de garantia indexado)");
    for (const block of blocks) {
      lines.push(`    ${block.ref}: ${clip(block.text, MAX_DIGEST_CELL_CHARS)}`);
    }
  }

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt e schema
// ────────────────────────────────────────────────────────────────────────────

const DISCARD_REASONS: PlanDiscardReason[] = [
  "duplicate",
  "filled_instance",
  "unreadable",
  "out_of_scope",
  "pii_unrecoverable",
];

/**
 * Issues que o MODELO pode declarar — e é por esta lista que a saída dele é
 * filtrada. `plan_invalid` fica de fora de propósito: ele é o veredicto dos
 * guardrails, não uma opinião do planner. Um modelo capaz de carimbar o próprio
 * plano como "recusado pela verificação automática" tornaria o carimbo inútil.
 */
const ISSUE_KINDS: PlanIssueKind[] = [
  "classification_conflict",
  "provider_in_template",
  "pii_leftover",
  "slot_not_applicable",
  "low_confidence",
  "grouping_ambiguous",
  "acervo_incompleto",
];

/**
 * Campo de vocabulário fechado que também aceita `null`.
 *
 * `{ type: ["string","null"], enum: [...valores, null] }` responde 400: o
 * validador de `output_config.format` compara cada valor do enum com o `type`
 * DECLARADO e não destrincha a união. Com `anyOf`, cada ramo fecha em si mesmo.
 * Mesma restrição — e mesma explicação longa — de `nullableEnum` em
 * `lib/ingestion/llm-classifier.ts`.
 */
function nullableEnum(values: readonly string[]): Record<string, unknown> {
  return { anyOf: [{ type: "string", enum: [...values] }, { type: "null" }] };
}

/** JSON Schema da saída do planner. Blocos por REFERÊNCIA, tags derivadas depois. */
export const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["templates", "clauses", "discards", "issues", "confidence"],
  properties: {
    templates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // Cada campo de `properties` entra em `required` — ver o cabeçalho de
        // `lib/ai/shared/schema-lint.ts`. Os que antes eram omitidos passam a
        // exigir um valor de AUSÊNCIA explícito (`[]`, `false`, `null`), e o
        // parse trata esse valor exatamente como tratava a omissão.
        required: [
          "sourceItemId",
          "name",
          "modalidade",
          "matchCriteria",
          "slotBlocks",
          "isDefaultSuggested",
          "groupId",
          "rationale",
        ],
        properties: {
          sourceItemId: { type: "string" },
          name: { type: "string" },
          modalidade: { type: "string" },
          matchCriteria: {
            type: "object",
            additionalProperties: false,
            required: ["garantia", "fiadorPessoa", "pessoa", "admImobiliaria"],
            properties: {
              garantia: nullableEnum(GARANTIA_TIPOS),
              fiadorPessoa: nullableEnum(["pf", "pj"]),
              pessoa: nullableEnum(["pf", "pj"]),
              admImobiliaria: { type: ["boolean", "null"] },
            },
          },
          slotBlocks: {
            type: "array",
            // Lista VAZIA, e não null, para dizer "nenhum espaço": o campo é uma
            // coleção e o vazio já é a forma natural de uma coleção sem itens —
            // duas maneiras de dizer a mesma coisa só dariam ao modelo uma
            // escolha sem consequência. O parse aceita as duas de qualquer jeito.
            description:
              "Trechos que saem do corpo e viram espaço. Use REFERÊNCIAS (B1, B2…). " +
              "Lista VAZIA quando o template não tem espaço a extrair.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["slot", "blockRefs"],
              properties: {
                slot: { type: "string", enum: ["garantia"] },
                blockRefs: { type: "array", items: { type: "string" } },
              },
            },
          },
          isDefaultSuggested: {
            type: "boolean",
            description:
              "true só no template que a família deve sugerir por padrão. " +
              "false nos demais — não omita.",
          },
          groupId: {
            type: ["string", "null"],
            description:
              "Grupo de quase idênticos que originou este template, ou null.",
          },
          rationale: { type: "string" },
        },
      },
    },
    clauses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot", "value", "provider", "title", "blockRefs", "sourceItemId", "rationale"],
        properties: {
          slot: { type: "string", enum: ["garantia"] },
          value: { type: "string", enum: [...GARANTIA_TIPOS] },
          provider: {
            type: ["string", "null"],
            description: 'Rótulo humano ("Porto Seguro") ou null na cláusula genérica.',
          },
          title: { type: "string" },
          blockRefs: {
            type: "array",
            description: "Referências dos parágrafos que formam a cláusula.",
            items: { type: "string" },
          },
          sourceItemId: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
    discards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["itemId", "reason", "detail"],
        properties: {
          itemId: { type: "string" },
          reason: { type: "string", enum: DISCARD_REASONS },
          detail: { type: "string" },
        },
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["itemId", "kind", "detail"],
        properties: {
          itemId: { type: ["string", "null"] },
          kind: { type: "string", enum: ISSUE_KINDS },
          detail: { type: "string" },
        },
      },
    },
    // Sem `minimum`/`maximum`: `output_config.format` recusa restrição de faixa
    // em número ("For 'number' type, properties maximum, minimum are not
    // supported"). A faixa fica na `description` — que o modelo lê — e em
    // `toConfidence`, que é quem a impõe.
    confidence: {
      type: "number",
      description:
        "Sua avaliação honesta do plano inteiro, de 0 (nenhuma confiança) a 1 " +
        "(certeza). Fora dessa faixa o valor é truncado.",
    },
  },
};

/** Regras que valem em qualquer família — o prefixo mais estável do prompt. */
const PLANNER_CORE = `Você decide o que o acervo de uma imobiliária brasileira vira na biblioteca de
modelos do sistema. Você recebe o LOTE INTEIRO já classificado e agrupado, e
devolve um PLANO. Responda SOMENTE com o JSON do schema.

## O que você decide, e o que você NÃO decide

Você decide QUAL documento vira template, quais viram cláusula do acervo, o que
é descarte e o que precisa de olho humano. Você NÃO redige: o corpo do template
vem do DOCX original (é ele que preserva o timbre da imobiliária) e o texto da
cláusula vem dos parágrafos que você referenciar.

## Referências de bloco

Os parágrafos divergentes do lote estão indexados como B1, B2, B3… no digest,
possivelmente truncados na exibição. Sempre que precisar apontar um parágrafo —
em \`slotBlocks.blockRefs\` ou em \`clauses.blockRefs\` — use a REFERÊNCIA. Nunca
copie nem reescreva o texto: o sistema materializa o parágrafo íntegro a partir
da referência. Uma referência de um item diferente do \`sourceItemId\` é erro.

## As duas regras de produto

1. GARANTIA DIFERENTE ⇒ TEMPLATE FÍSICO DIFERENTE.
2. SÓ O FORNECEDOR MUDA ⇒ MESMA BASE + CLÁUSULA com o fornecedor.

## Descartes

- \`duplicate\`: o mesmo documento já entrou por outro arquivo do lote;
- \`filled_instance\`: é um contrato PREENCHIDO de um cliente e existe uma minuta
  melhor no lote para o mesmo papel. Atenção: quando NÃO há alternativa, um
  contrato preenchido ainda é a melhor fonte de template que a imobiliária tem —
  não descarte o único documento de uma garantia só porque ele está preenchido;
- \`unreadable\`, \`out_of_scope\`, \`pii_unrecoverable\`: o que o nome diz.

## Issues — quando registrar

- \`classification_conflict\`: você discorda da classificação registrada;
- \`provider_in_template\`: o documento escolhido como base nomeia seguradora ou
  garantidora fora do trecho que virou slot;
- \`slot_not_applicable\`: o documento pede um espaço que a família não tem;
- \`grouping_ambiguous\`: o agrupamento não conta uma história coerente;
- \`acervo_incompleto\`: falta no lote um modelo que a imobiliária claramente usa
  (por exemplo, há cláusulas de quatro seguradoras mas nenhum contrato de fiador);
- \`pii_leftover\`, \`low_confidence\`: quando couber.

Registrar o desvio é sempre melhor que forçar um plano bonito. Mas NÃO invente
valores fora dos enums do schema.

## confidence

Sua avaliação honesta do plano inteiro, de 0 a 1. Abaixo de ${MIN_PLAN_CONFIDENCE} o
sistema refaz o plano com um modelo mais forte — subestimar custa uma chamada,
superestimar custa uma biblioteca errada.`;

function feedbackBlock(violations: readonly PlanViolation[]): string {
  if (violations.length === 0) return "";
  return [
    "",
    "## O PLANO ANTERIOR FOI RECUSADO",
    "",
    "As verificações determinísticas abaixo falharam. Corrija a CAUSA — não",
    "contorne removendo o item do plano se ele deveria estar lá.",
    "",
    ...violations.map((v) => `- [${v.kind}] ${v.detail}`),
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Materialização
// ────────────────────────────────────────────────────────────────────────────

interface RawTemplate {
  sourceItemId?: unknown;
  name?: unknown;
  modalidade?: unknown;
  matchCriteria?: Record<string, unknown> | null;
  slotBlocks?: Array<{ slot?: unknown; blockRefs?: unknown }> | null;
  isDefaultSuggested?: unknown;
  groupId?: unknown;
  rationale?: unknown;
}

interface RawClause {
  slot?: unknown;
  value?: unknown;
  provider?: unknown;
  title?: unknown;
  blockRefs?: unknown;
  sourceItemId?: unknown;
  rationale?: unknown;
}

interface RawPlan {
  templates?: RawTemplate[];
  clauses?: RawClause[];
  discards?: Array<{ itemId?: unknown; reason?: unknown; detail?: unknown }>;
  issues?: Array<{ itemId?: unknown; kind?: unknown; detail?: unknown }>;
  confidence?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Confiança em [0,1] — a ÚNICA guarda da faixa desde que `minimum`/`maximum`
 * saíram do schema (`output_config.format` os recusa).
 *
 * Trunca em vez de rejeitar: jogar fora um plano inteiro porque o número da
 * autoavaliação veio `1.2` seria trocar um defeito cosmético por uma chamada
 * cara perdida. O default é 0, e não 0.5 como na classificação: plano sem
 * autoavaliação fica ABAIXO de `MIN_PLAN_CONFIDENCE` e a escada escala, que é o
 * lado seguro de errar quando o campo não veio.
 */
function toConfidence(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Resolve referências em parágrafos literais. Referência desconhecida vira o
 * PRÓPRIO texto da referência — de propósito: ela não bate com nenhum parágrafo
 * do documento e o guardrail a rejeita com `slot_block_not_found`, em vez de
 * sumir e produzir um plano que parece correto.
 */
function resolveRefs(refs: unknown, index: BlockIndex): string[] {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((r) => str(r))
    .filter(Boolean)
    .map((ref) => index.byRef.get(ref)?.text ?? ref);
}

function toMatchCriteria(raw: Record<string, unknown> | null | undefined): PlannedMatchCriteria {
  const out: PlannedMatchCriteria = {};
  if (!raw) return out;
  const garantia = str(raw.garantia);
  if ((GARANTIA_TIPOS as readonly string[]).includes(garantia)) {
    out.garantia = garantia as PlannedMatchCriteria["garantia"];
  }
  if (raw.fiadorPessoa === "pf" || raw.fiadorPessoa === "pj") {
    out.fiadorPessoa = raw.fiadorPessoa;
  }
  if (raw.pessoa === "pf" || raw.pessoa === "pj") out.pessoa = raw.pessoa;
  if (typeof raw.admImobiliaria === "boolean") out.admImobiliaria = raw.admImobiliaria;
  return out;
}

function toTemplate(raw: RawTemplate, index: BlockIndex): PlannedTemplate {
  const slotBlocks: Partial<Record<ClauseSlotKey, string[]>> = {};
  for (const entry of raw.slotBlocks ?? []) {
    const slot = str(entry?.slot);
    if (!slot) continue;
    const blocks = resolveRefs(entry?.blockRefs, index);
    if (blocks.length === 0) continue;
    const key = slot as ClauseSlotKey;
    slotBlocks[key] = [...(slotBlocks[key] ?? []), ...blocks];
  }

  const template: PlannedTemplate = {
    sourceItemId: str(raw.sourceItemId),
    name: str(raw.name),
    modalidade: str(raw.modalidade),
    matchCriteria: toMatchCriteria(raw.matchCriteria),
    rationale: str(raw.rationale),
  };
  if (Object.keys(slotBlocks).length > 0) template.slotBlocks = slotBlocks;
  if (raw.isDefaultSuggested === true) template.isDefaultSuggested = true;
  const groupId = str(raw.groupId);
  if (groupId) template.groupId = groupId;
  return template;
}

function toClause(
  raw: RawClause,
  index: BlockIndex,
  entitiesByItem: ItemPiiEntities
): PlannedClause {
  const slot = str(raw.slot) as ClauseSlotKey;
  const value = str(raw.value);
  const provider = str(raw.provider) || null;
  const blocks = resolveRefs(raw.blockRefs, index);
  const sourceItemId = str(raw.sourceItemId);
  // Sanitização DETERMINÍSTICA: o conteúdo da cláusula é o único campo do plano
  // que vira texto persistido com embedding, e confiar no modelo para limpá-lo
  // seria confiar num julgamento onde o erro é irreversível.
  //
  // NOME e ENDEREÇO não têm detector por regex (`pii.ts` não faz NER de
  // propósito): quem os acha é o classificador LLM, que gravou os OFFSETS no
  // `piiReport` do item. Os trechos são resolvidos no texto do ITEM e entram
  // aqui como `externalEntities` — `resolveExternalEntities` faz busca LITERAL
  // dentro do conteúdo da cláusula, que é um recorte do mesmo texto. Resolver o
  // trecho e procurá-lo, em vez de traduzir offset de item para offset de
  // cláusula, é o caminho mais simples de provar correto: não há aritmética de
  // coordenadas para errar e a busca já trata múltiplas ocorrências.
  //
  // Item sem offsets confiáveis sai com a lista VAZIA — a cláusula segue com o
  // nome e é o gate do `plan-executor` que a barra, fechado.
  const externalEntities = entitiesByItem.get(sourceItemId) ?? [];
  const content = sanitizePii(blocks.join("\n\n"), undefined, { externalEntities }).text;

  return {
    slot,
    value,
    provider,
    title: str(raw.title),
    content,
    sourceItemId,
    // Tags DERIVADAS, nunca pedidas ao modelo: é por igualdade deste conjunto
    // que `ingestSlotClauses` decide o que arquivar.
    tags: [
      ...slotTagsFor(slot, value),
      ...(provider ? [providerTag(provider)] : []),
    ],
    rationale: str(raw.rationale),
  };
}

function toIssues(raw: RawPlan["issues"]): PlanIssue[] {
  const out: PlanIssue[] = [];
  for (const entry of raw ?? []) {
    const kind = str(entry?.kind) as PlanIssueKind;
    if (!ISSUE_KINDS.includes(kind)) continue;
    out.push({
      itemId: str(entry?.itemId) || null,
      kind,
      detail: str(entry?.detail),
    });
  }
  return out;
}

/** Nome e endereço já resolvidos, por item de origem. Ver {@link toClause}. */
export type ItemPiiEntities = ReadonlyMap<string, ExternalEntity[]>;

/**
 * Resolve, item a item, os offsets de nome/endereço gravados na classificação.
 * Item cujos offsets não batem com o texto entra com lista vazia — o planner não
 * é o gate. Quem falha fechado é o executor, antes de gravar.
 */
export function itemPiiEntities(items: readonly PlannerItem[]): ItemPiiEntities {
  const out = new Map<string, ExternalEntity[]>();
  for (const item of items) {
    const resolved = externalPiiEntities(item.text, item.piiReport ?? null);
    out.set(item.id, resolved.trusted ? resolved.entities : []);
  }
  return out;
}

/** Converte a saída crua do modelo no `LibraryPlan` do contrato. */
export function materializePlan(
  raw: RawPlan,
  index: BlockIndex,
  entitiesByItem: ItemPiiEntities = new Map()
): LibraryPlan {
  const confidence = toConfidence(raw.confidence);

  return {
    version: LIBRARY_PLAN_VERSION,
    templates: (raw.templates ?? []).map((t) => toTemplate(t, index)),
    clauses: (raw.clauses ?? []).map((c) => toClause(c, index, entitiesByItem)),
    discards: (raw.discards ?? [])
      .filter((d) => DISCARD_REASONS.includes(str(d?.reason) as PlanDiscardReason))
      .map((d) => ({
        itemId: str(d?.itemId),
        reason: str(d?.reason) as PlanDiscardReason,
        detail: str(d?.detail),
      })),
    issues: toIssues(raw.issues),
    confidence,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Issues determinísticas
// ────────────────────────────────────────────────────────────────────────────

/**
 * Divergências heurística × LLM viram issue. Não são opinião do planner: elas
 * já estão gravadas em `IngestionItem.classification.conflicts`, e é aqui que
 * chegam à tela de revisão.
 */
export function classificationConflictIssues(
  items: readonly PlannerItem[]
): PlanIssue[] {
  const out: PlanIssue[] = [];
  for (const item of items) {
    for (const c of item.classification?.conflicts ?? []) {
      out.push({
        itemId: item.id,
        kind: "classification_conflict",
        detail:
          `Em "${item.filename}", o palpite automático dizia ${c.field}=` +
          `${c.heuristic ?? "nenhum"} e a leitura do documento concluiu ` +
          `${c.llm ?? "nenhum"}. Valeu a leitura do documento.`,
      });
    }
  }
  return out;
}

/**
 * Regra 2, cobrada sobre o TEXTO: o documento que virou template nomeia uma
 * garantidora do catálogo padrão fora dos parágrafos que saíram para o slot.
 *
 * É issue e não violação de propósito — o caso real do corpus da Ativa é uma
 * cláusula de PINTURA INTERNA que cita "Porto Seguro" de passagem. Isso não
 * invalida o modelo; exige que alguém olhe antes de ativar.
 */
export function providerInTemplateIssues(
  plan: LibraryPlan,
  items: readonly PlannerItem[]
): PlanIssue[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: PlanIssue[] = [];

  for (const template of plan.templates) {
    const item = byId.get(template.sourceItemId);
    if (!item) continue;
    const inSlot = new Set(Object.values(template.slotBlocks ?? {}).flat());
    const body = toParagraphs(item.text)
      .filter((p) => !inSlot.has(p))
      .join("\n");
    // Espaços nas bordas + espaços nas bordas do alvo = casamento por PALAVRA
    // sobre a chave normalizada. Sem isso, o garantidor "Too" do catálogo
    // padrão casaria dentro de qualquer palavra que contenha "too".
    const key = ` ${paragraphKey(body)} `;

    const found = Array.from(
      new Set(
        DEFAULT_GARANTIA_OPTIONS.map((o) => o.provider).filter((p) =>
          key.includes(` ${paragraphKey(p)} `)
        )
      )
    );
    if (found.length === 0) continue;
    out.push({
      itemId: template.sourceItemId,
      kind: "provider_in_template",
      detail:
        `O modelo "${template.name}" ainda nomeia ${found.join(", ")} no corpo, ` +
        `fora do espaço de garantia. O modelo tem de ser neutro de fornecedor — ` +
        `revise antes de ativar.`,
    });
  }
  return out;
}

/**
 * Violações viram issues quando o plano é entregue à revisão em vez de
 * executado.
 *
 * O default é `plan_invalid`, e a distinção importa para quem lê a tela: "o
 * modelo hesitou" (`low_confidence`, que é AUTOAVALIAÇÃO do planner abaixo do
 * piso) e "o modelo propôs algo proibido" (`plan_invalid`, regra dura que
 * sobreviveu à escalação) pedem reações diferentes do operador. Mandar
 * violação de regra dura para `low_confidence` fazia a tela mentir. As duas
 * exceções abaixo continuam existindo porque nomeiam o problema com mais
 * precisão que "recusado": `pii_leftover` diz ONDE olhar, `slot_not_applicable`
 * diz O QUE não encaixa.
 */
function violationToIssue(v: PlanViolation): PlanIssue {
  const kind: PlanIssueKind =
    v.kind === "clause_pii"
      ? "pii_leftover"
      : v.kind === "slot_not_applicable" ||
          v.kind === "slot_block_not_found" ||
          v.kind === "slot_block_too_short"
        ? "slot_not_applicable"
        : "plan_invalid";
  return { itemId: v.itemId, kind, detail: v.detail };
}

// ────────────────────────────────────────────────────────────────────────────
// A chamada
// ────────────────────────────────────────────────────────────────────────────

/**
 * Houve escalação? Verdadeiro quando alguma tentativa saiu do degrau BASE — seja
 * por profundidade (`effort`) ou por modelo. Derivado das tentativas, e não de
 * um booleano mantido à mão, porque é ele que o relatório do run mostra e um
 * flag esquecido num ramo diria que o plano saiu de primeira quando não saiu.
 */
function escalatedIn(
  attempts: readonly PlanAttemptRecord[],
  ladder: readonly PlanStep[]
): boolean {
  const base = ladder[0];
  return attempts.some((a) => a.model !== base.model || a.effort !== base.effort);
}

function guardItems(items: readonly PlannerItem[]): PlanGuardItem[] {
  return items.map((i) => ({
    id: i.id,
    filename: i.filename,
    text: i.text,
    status: i.status,
    modalidade: i.classification?.modalidade ?? null,
  }));
}

/**
 * Roda o planner e devolve o plano com o veredicto dos guardrails.
 *
 * Nunca escreve no banco: o run é quem persiste `libraryPlan`. Nunca "conserta"
 * um plano recusado.
 */
export async function planLibrary(
  input: PlanLibraryInput,
  options: PlanLibraryOptions = {}
): Promise<PlanLibraryResult> {
  const call = options.structured ?? runStructured;
  const planModel = options.planModel ?? INGEST_PLAN_MODEL;
  const escalationModel = options.escalationModel ?? INGEST_ESCALATION_MODEL;

  /**
   * A escada da escalação. Os dois primeiros degraus são o MESMO modelo e a
   * mesma profundidade — o segundo existe só para devolver as violações e dar
   * ao modelo a chance de corrigir. O terceiro sobe o `effort`; o quarto, o
   * modelo. Ver {@link DEPTH_STEP_INDEX}.
   */
  const ladder: PlanStep[] = [
    { model: planModel, effort: "high" },
    { model: planModel, effort: "high" },
    { model: planModel, effort: "xhigh" },
    { model: escalationModel, effort: "xhigh" },
  ];

  const analysis = analyzeBatch(input);
  const index = analysis.index;
  const piiEntities = itemPiiEntities(input.items);
  const digest = buildBatchDigest(input, analysis);
  const items = guardItems(input.items);
  const playbooks = playbooksForModalidades(
    input.items.map((i) => i.classification?.modalidade ?? null)
  );
  const system = [
    { text: PLANNER_CORE, cache: false },
    // Breakpoint no ÚLTIMO bloco estável: núcleo + playbooks são idênticos
    // entre runs da mesma família, e o digest (volátil) vem só no turno do
    // usuário. Invertida, a ordem faria cada lote pagar o prefixo inteiro.
    { text: playbooks.map((p) => p.prompt).join("\n\n"), cache: true },
  ];

  const attempts: PlanAttemptRecord[] = [];
  let stepIndex = 0;
  let feedback: PlanViolation[] = [];
  let last: { plan: LibraryPlan; violations: PlanViolation[] } | null = null;

  for (let attempt = 1; attempt <= ladder.length; attempt++) {
    options.meter?.assertWithinCap();
    const step = ladder[stepIndex];

    const result = await call<RawPlan>({
      model: step.model,
      system,
      userContent: `${digest}${feedbackBlock(feedback)}`,
      schema: PLAN_SCHEMA,
      maxTokens: 16_000,
      effort: step.effort,
      // 16.000 tokens de saída com `effort` alto é minutos de geração. Sem
      // streaming a requisição fica muda até a resposta inteira ficar pronta, e
      // foi assim que esta chamada morreu no `maxDuration` da função em staging.
      stream: true,
    });

    if (options.meter) {
      await options.meter.record({
        operation: "ingest_plan",
        model: result.model,
        usage: result.usage,
        latencyMs: result.latencyMs,
      });
    }

    const plan = materializePlan(result.data ?? {}, index, piiEntities);
    plan.issues = [
      ...plan.issues,
      ...classificationConflictIssues(input.items),
      ...providerInTemplateIssues(plan, input.items),
    ];

    const verdict = validateLibraryPlan({ plan, items });
    attempts.push({
      attempt,
      model: step.model,
      effort: step.effort,
      ok: verdict.ok,
      confidence: plan.confidence,
      violations: verdict.violations,
      durationMs: result.latencyMs,
    });
    last = { plan, violations: verdict.violations };

    if (verdict.ok && plan.confidence >= MIN_PLAN_CONFIDENCE) {
      return { plan, accepted: true, attempts, escalated: escalatedIn(attempts, ladder) };
    }

    // Último degrau: não há para onde subir.
    if (stepIndex >= ladder.length - 1) break;

    if (!verdict.ok) {
      feedback = verdict.violations;
      // Um degrau por recusa. O 2º degrau é a MESMA pergunta com as violações
      // em mãos; a partir da segunda recusa a escada já subiu para o effort
      // maior, que é onde a profundidade muda de verdade.
      stepIndex += 1;
    } else {
      // Plano válido, mas o próprio planner não confia nele. Não há violação a
      // devolver, então repetir no mesmo degrau não muda nada: pula direto para
      // onde a profundidade sobe.
      feedback = [];
      stepIndex = Math.max(stepIndex + 1, DEPTH_STEP_INDEX);
    }
  }

  const plan = last?.plan ?? {
    version: LIBRARY_PLAN_VERSION,
    templates: [],
    clauses: [],
    discards: [],
    issues: [],
    confidence: 0,
  };
  const violations = last?.violations ?? [];
  plan.issues = [
    ...plan.issues,
    ...violations.map(violationToIssue),
    ...(plan.confidence < MIN_PLAN_CONFIDENCE
      ? [
          {
            itemId: null,
            kind: "low_confidence" as const,
            detail:
              `O plano saiu com confiança ${plan.confidence.toFixed(2)}, abaixo do ` +
              `mínimo de ${MIN_PLAN_CONFIDENCE}. Revise item a item antes de aplicar.`,
          },
        ]
      : []),
  ];

  return { plan, accepted: false, attempts, escalated: escalatedIn(attempts, ladder) };
}
