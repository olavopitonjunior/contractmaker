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
 * sobe um degrau da escada ({@link PLAN_LADDER_STEPS} degraus, ver `buildLadder`).
 * A primeira escalação NÃO troca de modelo: sobe o `effort` de `high` para
 * `xhigh` no mesmo Opus 4.8. Opus 4.8 e Opus 5 custam o mesmo por token, então
 * mais profundidade sai mais barato que outro modelo (menos tokens gerados do
 * zero) e o comportamento continua previsível. Só quando nem o `xhigh` resolve é
 * que o Opus 5 entra.
 *
 * Persistindo, o run NÃO é executado: o plano volta com `accepted: false` e as
 * issues explicando, para a revisão humana decidir. Um plano recusado custa
 * revisão a mais; um plano consertado em silêncio custa uma biblioteca errada.
 *
 * ## UM degrau por invocação
 *
 * `planLibrary` faz UMA chamada e volta. A escada inteira NÃO cabe numa
 * invocação: uma chamada medida em staging levou 147s (23.708 tokens de entrada,
 * 11.602 de saída, US$ 0,44) contra os 300s de `maxDuration` da rota — duas já
 * estouram. Rodando a escada em laço, foi exatamente o que aconteceu: a primeira
 * chamada voltou e foi cobrada, os guardrails recusaram o plano, a segunda
 * começou e a função morreu aos 301s, levando junto o motivo da recusa.
 *
 * Então o degrau vira a unidade de trabalho da FATIA do pipeline: o estado da
 * escada ({@link PlanLadderState}) entra por `options.ladder`, o resultado
 * devolve o próximo degrau em `nextLadder`, e quem persiste e re-encadeia é o
 * executor do run — a mesma maquinaria (claim atômico, `hasMore`, sweeper) que
 * já move os outros estágios.
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
  type LibrarySnapshotLike,
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

/**
 * A escada da escalação. Os dois primeiros degraus são o MESMO modelo e a mesma
 * profundidade — o segundo existe só para devolver as violações e dar ao modelo
 * a chance de corrigir. O terceiro sobe o `effort`; o quarto, o modelo. Ver
 * {@link DEPTH_STEP_INDEX}.
 */
export function buildLadder(planModel: string, escalationModel: string): PlanStep[] {
  return [
    { model: planModel, effort: "high" },
    { model: planModel, effort: "high" },
    { model: planModel, effort: "xhigh" },
    { model: escalationModel, effort: "xhigh" },
  ];
}

/**
 * Quantos degraus a escada tem. É o teto de chamadas PAGAS de um plano que
 * corre sem intercorrência, e por isso o teto de degraus do run
 * (`MAX_PLAN_STEPS`, em run-executor.ts) não pode ser menor — senão a escada
 * seria truncada em silêncio antes de chegar ao último modelo.
 */
export const PLAN_LADDER_STEPS = buildLadder("", "").length;

/** Teto por célula da matriz de divergência levada ao prompt. */
export const MAX_DIGEST_CELL_CHARS = 600;

/**
 * Orçamento GLOBAL do índice de blocos — um lote patológico não pode estourar o
 * contexto.
 *
 * O teto NÃO é gasto por ordem de chegada: ele é repartido entre as famílias do
 * lote (ver {@link allocateFamilyBudgets}). Por ordem de chegada, as primeiras
 * famílias consumiam o índice inteiro e as últimas chegavam ao planner sem um
 * único parágrafo citável — sem erro, sem aviso, e com o plano saindo "válido".
 */
export const MAX_INDEXED_BLOCKS = 200;

/** Família de um item que o agrupamento não conhece. Não deve acontecer. */
const UNKNOWN_FAMILY = "(sem família)";

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
  /**
   * O que a biblioteca do tenant já tem (ver `library-snapshot.ts`). Ausente =
   * planeja como se o acervo estivesse vazio — comportamento dos runs antigos.
   */
  library?: LibrarySnapshotLike & {
    clauseTagSets?: readonly (readonly string[])[];
    operatorNotes?: readonly string[];
  };
  /**
   * Comentários do operador para ESTE replanejamento (a caixa "reprocessar com
   * instruções" da revisão). Diferente das notas persistentes: valem só para a
   * chamada em curso e entram no fim do turno do usuário, com o feedback.
   */
  operatorComments?: readonly string[];
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

/**
 * Onde a escada parou — o que atravessa invocações.
 *
 * As VIOLAÇÕES do degrau anterior, que são o insumo do prompt seguinte, não têm
 * campo próprio: elas são as do último registro de `attempts`. Um campo separado
 * guardaria os mesmos bytes num segundo lugar, e o segundo lugar é onde a cópia
 * envelhece.
 */
export interface PlanLadderState {
  /** Degrau a executar nesta invocação. */
  stepIndex: number;
  /** Degraus que já rodaram e VOLTARAM, em ordem. */
  attempts: PlanAttemptRecord[];
}

export interface PlanLibraryOptions {
  structured?: StructuredRunner;
  meter?: IngestionAiMeter;
  planModel?: string;
  escalationModel?: string;
  /** Onde a escada parou. Ausente = primeiro degrau. */
  ladder?: PlanLadderState;
  /**
   * Quantos degraus este run ainda pode PAGAR. Chegando em 1, o degrau desta
   * invocação é tratado como último: o plano vai para a revisão humana com as
   * issues em vez de pedir uma chamada que o run não tem mais como comprar.
   */
  stepBudget?: number;
}

export interface PlanLibraryResult {
  plan: LibraryPlan;
  /** Passou nos guardrails E na confiança mínima. */
  accepted: boolean;
  /** Histórico CUMULATIVO: os degraus anteriores mais o desta invocação. */
  attempts: PlanAttemptRecord[];
  escalated: boolean;
  /** O planner viu o lote inteiro? Vai para o `report` do run. */
  indexBudget: IndexBudgetReport;
  /**
   * O próximo degrau, ou `null` quando a escada acabou (plano aceito, último
   * degrau ou orçamento de degraus no fim). Não-nulo = o run continua em
   * `planning` e a corrente reentra.
   */
  nextLadder: PlanLadderState | null;
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

/** Quanto do índice uma família perdeu para o orçamento. */
export interface FamilyIndexBudget {
  familyKey: string;
  indexed: number;
  dropped: number;
}

/**
 * O que o índice deixou de fora. Vai para o `report` do run e vira issue no
 * plano: um corte que só aparece no log produz um plano que PARECE certo, com
 * famílias planejadas a partir de material que o modelo nunca viu.
 */
export interface IndexBudgetReport {
  /** {@link MAX_INDEXED_BLOCKS} vigente quando o lote foi analisado. */
  limit: number;
  indexed: number;
  dropped: number;
  truncated: boolean;
  /** Só as famílias que perderam parágrafos, da que mais perdeu para a que menos. */
  families: FamilyIndexBudget[];
  /** Itens que perderam ao menos um parágrafo. É o que torna o digest honesto. */
  droppedItemIds: string[];
}

export interface BatchAnalysis {
  index: BlockIndex;
  groups: GroupDifference[];
  singles: PlannerItem[];
  /** O índice cortou alguma coisa? Ver {@link IndexBudgetReport}. */
  budget: IndexBudgetReport;
}

/** Um parágrafo candidato ao índice, antes de saber se há orçamento para ele. */
interface BlockCandidate {
  itemId: string;
  familyKey: string;
  text: string;
}

interface PendingCell {
  itemId: string;
  candidates: BlockCandidate[];
}

interface PendingRow {
  anchorIndex: number;
  primary: boolean;
  cells: PendingCell[];
}

interface PendingGroup {
  group: ConsolidationCandidate;
  commonParagraphCount: number;
  commonPreview: string;
  rows: PendingRow[];
}

/**
 * Reparte `budget` entre as famílias por MAX-MIN FAIRNESS: da que menos pede
 * para a que mais pede, cada família leva o que pediu ou a fatia igual do que
 * sobrou — o que for menor.
 *
 * A escolha é essa, e não um rateio proporcional, por duas propriedades que o
 * corte precisa ter. (1) Enquanto o lote inteiro couber, TODA família leva tudo:
 * o lote que funciona hoje não muda em nada. (2) Passado o teto, quem é cortado
 * é só quem pede acima da média, e nunca até zero — a família pequena (a única
 * minuta de fiador do acervo) continua inteira, que é justamente o material que
 * o proporcional reduziria a um parágrafo.
 *
 * Com MAIS famílias que orçamento a soma passa do teto, de propósito: família
 * muda no índice é o defeito que este cálculo existe para não ter, e um
 * parágrafo por família custa menos que o plano decidir sem saber que ela existe.
 */
function allocateFamilyBudgets(
  demand: ReadonlyMap<string, number>,
  budget: number
): Map<string, number> {
  const out = new Map<string, number>();
  const families = [...demand].sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0])
  );
  let remaining = budget;
  let pending = families.length;
  for (const [familyKey, wanted] of families) {
    const share = Math.max(1, Math.floor(remaining / pending));
    const granted = Math.min(wanted, share);
    out.set(familyKey, granted);
    remaining -= granted;
    pending -= 1;
  }
  return out;
}

/**
 * Escolhe QUAIS parágrafos da família entram, em rodadas por documento. Ficar
 * só com o começo da lista deixaria os últimos documentos da família sem nada —
 * o mesmo defeito do teto cego, um nível abaixo.
 */
function admitByRound(
  candidates: readonly BlockCandidate[],
  quota: number
): Set<BlockCandidate> {
  const admitted = new Set<BlockCandidate>();
  if (quota <= 0 || candidates.length === 0) return admitted;

  const byItem = new Map<string, BlockCandidate[]>();
  for (const candidate of candidates) {
    const list = byItem.get(candidate.itemId);
    if (list) list.push(candidate);
    else byItem.set(candidate.itemId, [candidate]);
  }
  const queues = [...byItem.values()];
  const rounds = Math.max(...queues.map((q) => q.length));

  for (let round = 0; round < rounds && admitted.size < quota; round++) {
    for (const queue of queues) {
      if (admitted.size >= quota) break;
      if (round < queue.length) admitted.add(queue[round]);
    }
  }
  return admitted;
}

/**
 * Coleta os parágrafos citáveis do lote e só no fim decide quais cabem.
 *
 * Coletar antes de cortar é o que permite um corte informado: a demanda de cada
 * família só é conhecida depois de percorrer o lote inteiro, e é ela que diz
 * quanto do índice cada família merece.
 */
class BlockCollector {
  private readonly seen = new Map<string, BlockCandidate>();
  private readonly order: BlockCandidate[] = [];

  push(itemId: string, familyKey: string, text: string): BlockCandidate | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const dedupe = `${itemId}\u0000${paragraphKey(trimmed)}`;
    const existing = this.seen.get(dedupe);
    if (existing) return existing;

    const candidate: BlockCandidate = { itemId, familyKey, text: trimmed };
    this.seen.set(dedupe, candidate);
    this.order.push(candidate);
    return candidate;
  }

  /**
   * Fecha o índice: reparte o orçamento, admite por rodadas e só então numera as
   * referências. A numeração segue a ordem de COLETA, e não a de admissão, para
   * que `B1, B2, B3…` continuem aparecendo em ordem crescente no digest.
   */
  build(budget: number): {
    index: BlockIndex;
    blockOf: (candidate: BlockCandidate) => IndexedBlock | null;
    report: IndexBudgetReport;
  } {
    const byFamily = new Map<string, BlockCandidate[]>();
    for (const candidate of this.order) {
      const list = byFamily.get(candidate.familyKey);
      if (list) list.push(candidate);
      else byFamily.set(candidate.familyKey, [candidate]);
    }
    const quotas = allocateFamilyBudgets(
      new Map([...byFamily].map(([key, list]) => [key, list.length])),
      budget
    );

    const admitted = new Set<BlockCandidate>();
    const families: FamilyIndexBudget[] = [];
    for (const [familyKey, candidates] of byFamily) {
      const kept = admitByRound(candidates, quotas.get(familyKey) ?? 0);
      for (const candidate of kept) admitted.add(candidate);
      const dropped = candidates.length - kept.size;
      if (dropped > 0) families.push({ familyKey, indexed: kept.size, dropped });
    }
    families.sort(
      (a, b) => b.dropped - a.dropped || a.familyKey.localeCompare(b.familyKey)
    );

    const byRef = new Map<string, IndexedBlock>();
    const byItem = new Map<string, IndexedBlock[]>();
    const blocks = new Map<BlockCandidate, IndexedBlock>();
    const droppedItems = new Set<string>();
    let n = 0;
    for (const candidate of this.order) {
      if (!admitted.has(candidate)) {
        droppedItems.add(candidate.itemId);
        continue;
      }
      n += 1;
      const block: IndexedBlock = {
        ref: `B${n}`,
        itemId: candidate.itemId,
        text: candidate.text,
      };
      blocks.set(candidate, block);
      byRef.set(block.ref, block);
      const list = byItem.get(candidate.itemId);
      if (list) list.push(block);
      else byItem.set(candidate.itemId, [block]);
    }

    return {
      index: { byRef, byItem },
      blockOf: (candidate) => blocks.get(candidate) ?? null,
      report: {
        limit: budget,
        indexed: n,
        dropped: this.order.length - n,
        truncated: this.order.length > n,
        families,
        droppedItemIds: [...droppedItems].sort(),
      },
    };
  }
}

/** itemId → família fina, com o agrupamento como fonte e a classificação como reserva. */
function familyKeyIndex(input: PlanLibraryInput): Map<string, string> {
  const out = new Map<string, string>();
  for (const family of input.grouping.families) {
    for (const id of family.itemIds) out.set(id, family.familyKey);
  }
  for (const item of input.items) {
    if (!out.has(item.id)) {
      out.set(item.id, item.classification?.familyKey ?? UNKNOWN_FAMILY);
    }
  }
  return out;
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
  const collector = new BlockCollector();
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const familyOf = familyKeyIndex(input);
  const pending: PendingGroup[] = [];

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

    const rows: PendingRow[] = [];
    for (const row of matrix.slice(0, MAX_DIFFERENCE_ROWS_PER_GROUP)) {
      const cells = Object.entries(row.byDoc)
        .map(([itemId, paragraphs]) => ({
          itemId,
          candidates: paragraphs
            .map((p) =>
              collector.push(itemId, familyOf.get(itemId) ?? candidate.familyKey, p)
            )
            .filter((b): b is BlockCandidate => Boolean(b)),
        }))
        .filter((cell) => cell.candidates.length > 0);
      if (cells.length === 0) continue;
      rows.push({
        anchorIndex: row.anchorIndex,
        primary: row.anchorIndex === primaryAnchor,
        cells,
      });
    }

    pending.push({
      group: candidate,
      commonParagraphCount: consolidation.commonParagraphs.length,
      commonPreview: clip(consolidation.commonParagraphs[0] ?? "", MAX_DIGEST_CELL_CHARS),
      rows,
    });
  }

  const grouped = new Set(input.grouping.groups.flatMap((g) => g.memberIds));
  const singles = input.items.filter((i) => !grouped.has(i.id));
  for (const item of singles) {
    const familyKey = familyOf.get(item.id) ?? UNKNOWN_FAMILY;
    for (const excerpt of garantiaExcerpts(item.text)) {
      for (const p of excerpt.paragraphs) collector.push(item.id, familyKey, p);
    }
  }

  const { index, blockOf, report } = collector.build(MAX_INDEXED_BLOCKS);

  // Célula e linha que ficaram sem bloco algum somem da matriz: exibir uma
  // posição de divergência vazia diria ao planner que os membros não divergem
  // ali, que é o oposto do que aconteceu.
  const groups: GroupDifference[] = pending.map((g) => ({
    group: g.group,
    commonParagraphCount: g.commonParagraphCount,
    commonPreview: g.commonPreview,
    rows: g.rows
      .map((row) => ({
        anchorIndex: row.anchorIndex,
        primary: row.primary,
        cells: row.cells
          .map((cell) => ({
            itemId: cell.itemId,
            blocks: cell.candidates
              .map(blockOf)
              .filter((b): b is IndexedBlock => Boolean(b)),
          }))
          .filter((cell) => cell.blocks.length > 0),
      }))
      .filter((row) => row.cells.length > 0),
  }));

  return { index, groups, singles, budget: report };
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
 * O aviso que mantém o digest HONESTO quando o índice virou amostra.
 *
 * Um modelo que acha que viu o lote inteiro decide diferente de um que sabe que
 * viu parte: o primeiro conclui "esta família não tem cláusula de fiança" a
 * partir de uma ausência que é do índice, não do acervo. O aviso vai no TOPO,
 * antes de qualquer documento, porque é premissa de tudo o que vem depois.
 */
function indexBudgetNotice(budget: IndexBudgetReport): string[] {
  if (!budget.truncated) return [];
  return [
    "## ATENÇÃO — O ÍNDICE DE BLOCOS ABAIXO É UMA AMOSTRA DO LOTE",
    "",
    `O lote não coube inteiro no índice: ${budget.indexed} parágrafos foram indexados e ` +
      `${budget.dropped} ficaram de fora. O orçamento foi repartido entre as famílias, ` +
      "então nenhuma ficou sem blocos — mas estas estão representadas por parte do " +
      "material:",
    ...budget.families.map(
      (f) => `- ${f.familyKey}: ${f.indexed} parágrafos no índice, ${f.dropped} fora`,
    ),
    "",
    "Planeje com o que está aqui e NÃO conclua que um trecho não existe só porque ele " +
      "não aparece: registre uma issue `index_truncated` nomeando as famílias em que " +
      "você decidiu sem ver o material inteiro.",
    "",
  ];
}

/**
 * O digest do lote — classificações, matriz de agrupamento e o índice de blocos.
 * É o único conteúdo VOLÁTIL da chamada e por isso vai no turno do usuário,
 * depois do breakpoint de cache do system.
 */
/**
 * A biblioteca existente, na forma que o planner consome. Vem ANTES dos
 * documentos porque é premissa: cada decisão sobre o lote é relativa ao que o
 * tenant já tem — um seguro-fiança residencial não vira template novo se um
 * template com esse critério já existe e a base do lote não é melhor.
 */
function librarySection(library: PlanLibraryInput["library"]): string[] {
  if (!library) return [];
  const lines: string[] = ["## BIBLIOTECA ATUAL DO CLIENTE", ""];
  if (library.templates.length === 0) {
    lines.push("(nenhum modelo ainda — biblioteca vazia)");
  } else {
    lines.push("Modelos existentes (active/draft):");
    for (const t of library.templates) {
      const mc = Object.entries(t.matchCriteria ?? {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${String(v)}`)
        .sort()
        .join(", ");
      lines.push(`- ${t.modalidade} · {${mc}} · "${t.name}"`);
    }
  }
  const tagSets = library.clauseTagSets ?? [];
  if (tagSets.length > 0) {
    lines.push("", "Cláusulas já no acervo (conjuntos de etiquetas):");
    for (const set of tagSets) lines.push(`- ${[...set].join(", ")}`);
  }
  lines.push(
    "",
    "Documento cujo papel a biblioteca JÁ cobre (mesmo modalidade e critério) e",
    "cuja base do lote NÃO é melhor que a existente: descarte com",
    "`already_covered`, nomeando o modelo existente no detail. Propor cláusula",
    "com conjunto de etiquetas que já existe SUBSTITUI a anterior — proponha",
    "apenas quando a redação do lote for mais completa ou mais atual.",
    ""
  );
  return lines;
}

/** Instruções persistentes do operador — parametrização do tenant, não do run. */
function operatorNotesSection(notes: readonly string[] | undefined): string[] {
  if (!notes || notes.length === 0) return [];
  return [
    "## INSTRUÇÕES DO OPERADOR DESTE CLIENTE (valem para todo lote)",
    "",
    ...notes.map((n) => `- ${n}`),
    "",
  ];
}

export function buildBatchDigest(
  input: PlanLibraryInput,
  analysis: BatchAnalysis
): string {
  const lines: string[] = [
    ...indexBudgetNotice(analysis.budget),
    ...librarySection(input.library),
    ...operatorNotesSection(input.library?.operatorNotes),
  ];
  const cut = new Set(analysis.budget.droppedItemIds);

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
    if (blocks.length === 0) {
      // A distinção importa: "não achei trecho de garantia neste documento" e
      // "achei e não coube" levam o planner a decisões opostas sobre a família.
      lines.push(
        cut.has(item.id)
          ? "    (os trechos de garantia deste documento não couberam no índice)"
          : "    (sem trecho de garantia indexado)"
      );
    }
    for (const block of blocks) {
      lines.push(`    ${block.ref}: ${clip(block.text, MAX_DIGEST_CELL_CHARS)}`);
    }
    if (blocks.length > 0 && cut.has(item.id)) {
      lines.push("    (parte dos trechos deste documento não coube no índice)");
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
  "already_covered",
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
  "index_truncated",
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

O índice pode ser uma AMOSTRA do lote. Quando for, o digest avisa no topo e diz
quais famílias ficaram parcialmente representadas — nesse caso, planeje com o
que está no índice e registre \`index_truncated\` nomeando essas famílias.

## As regras de produto

1. GARANTIA DIFERENTE ⇒ TEMPLATE FÍSICO DIFERENTE.
2. SÓ O FORNECEDOR MUDA ⇒ MESMA BASE + CLÁUSULA com o fornecedor.
3. A CLÁUSULA DE FORNECEDOR É UMA SÓ, compartilhada entre residencial e
   comercial: NUNCA proponha duas cláusulas com o mesmo conjunto de etiquetas
   (mesma garantia + mesmo fornecedor) — variante "comercial" de uma cláusula
   que já existe para residencial é a MESMA cláusula.
4. NO MÁXIMO UM \`isDefaultSuggested: true\` POR MODALIDADE — o principal é um só.
5. O TEMPLATE É NEUTRO DE FORNECEDOR: se a base escolhida nomeia seguradora ou
   garantidora fora do trecho que vira slot, registre \`provider_in_template\`.

## A biblioteca que já existe

Quando o digest trouxer a seção BIBLIOTECA ATUAL, cada decisão é RELATIVA a ela:

- Modelo existente com o mesmo modalidade+critério do que você proporia ⇒ o
  documento do lote é \`already_covered\`, salvo se a base do lote for
  CLARAMENTE melhor (minuta em branco contra contrato preenchido, versão mais
  completa) — nesse caso proponha e explique no rationale que ela substitui a
  existente.
- Cláusula com conjunto de etiquetas que já existe no acervo SUBSTITUI a
  anterior: proponha apenas se a redação do lote for mais completa ou atual.

## Descartes

- \`duplicate\`: o mesmo documento já entrou por outro arquivo do lote;
- \`filled_instance\`: é um contrato PREENCHIDO de um cliente e existe uma minuta
  melhor no lote para o mesmo papel. Atenção: quando NÃO há alternativa, um
  contrato preenchido ainda é a melhor fonte de template que a imobiliária tem —
  não descarte o único documento de uma garantia só porque ele está preenchido;
- \`already_covered\`: a biblioteca atual já tem um modelo com esse papel e a
  base do lote não é melhor — nomeie o modelo existente no detail;
- \`unreadable\`, \`out_of_scope\`, \`pii_unrecoverable\`: o que o nome diz.

## Issues — quando registrar

- \`classification_conflict\`: você discorda da classificação registrada;
- \`provider_in_template\`: o documento escolhido como base nomeia seguradora ou
  garantidora fora do trecho que virou slot;
- \`slot_not_applicable\`: o documento pede um espaço que a família não tem;
- \`grouping_ambiguous\`: o agrupamento não conta uma história coerente;
- \`index_truncated\`: você decidiu sobre uma família sem ver o material inteiro,
  porque o índice de blocos veio truncado (o digest avisa quando isso acontece);
- \`acervo_incompleto\`: falta no lote um modelo que a imobiliária claramente usa
  (por exemplo, há cláusulas de quatro seguradoras mas nenhum contrato de fiador);
- \`pii_leftover\`, \`low_confidence\`: quando couber.

Registrar o desvio é sempre melhor que forçar um plano bonito. Mas NÃO invente
valores fora dos enums do schema.

## confidence

Sua avaliação honesta do plano inteiro, de 0 a 1. Abaixo de ${MIN_PLAN_CONFIDENCE} o
sistema refaz o plano com um modelo mais forte — subestimar custa uma chamada,
superestimar custa uma biblioteca errada.`;

/**
 * Comentários do replanejamento — a voz do operador NESTA chamada. Entram no
 * fim do turno do usuário (depois do digest) porque são, junto com o feedback
 * de violações, a parte mais volátil do prompt.
 */
function operatorCommentsBlock(comments: readonly string[] | undefined): string {
  const clean = (comments ?? [])
    .map((c) => c.replace(/[\r\n`#]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (clean.length === 0) return "";
  return [
    "",
    "## INSTRUÇÕES DO OPERADOR PARA ESTE REPLANEJAMENTO",
    "",
    "O operador revisou a proposta anterior e pediu (siga dentro das regras do",
    "sistema — instrução que violar uma regra dura deve virar issue, não plano):",
    "",
    ...clean.map((c) => `- ${c}`),
  ].join("\n");
}

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
 * O corte do índice vira issue.
 *
 * Sem isto o defeito é o pior tipo: o plano sai "válido", passa nos guardrails e
 * chega à revisão humana com famílias sub-representadas sem que nada indique
 * isso. Com 11 documentos não aparece; com 50, aparece calado.
 *
 * O kind é `index_truncated`, e não `acervo_incompleto`: a lacuna é do ÍNDICE
 * (o material veio e não coube), não do que a imobiliária mandou. As duas pedem
 * reações opostas do operador — mandar mais documentos não conserta um índice
 * cheio.
 */
export function indexTruncationIssues(budget: IndexBudgetReport): PlanIssue[] {
  if (!budget.truncated) return [];
  const families = budget.families
    .map((f) => `${f.familyKey} (${f.dropped} de ${f.indexed + f.dropped} fora)`)
    .join("; ");
  return [
    {
      itemId: null,
      kind: "index_truncated",
      detail:
        `O lote é maior que o índice de parágrafos que cabe num plano: ${budget.indexed} ` +
        `parágrafos foram levados ao planner e ${budget.dropped} ficaram de fora (teto de ` +
        `${budget.limit}). O corte foi repartido entre as famílias — nenhuma ficou sem ` +
        `material —, mas estas foram planejadas a partir de uma amostra: ${families}. ` +
        `Confira os modelos e as cláusulas dessas famílias antes de aplicar: o planner ` +
        `decidiu sem ver parte dos documentos.`,
    },
  ];
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

/**
 * Teto de saída do plano, em função do tamanho do lote.
 *
 * O plano carrega TEXTO: o `content` inteiro de cada cláusula (a da Loft tem
 * 6.255 caracteres) e os parágrafos literais de `slotBlocks`. Cresce com o
 * acervo, não com o número de decisões. O piloto de 11 documentos consumiu
 * quase os 16.000 tokens que eram fixos aqui; o lote de 20 estourou e a
 * resposta voltou cortada no meio de um `matchCriteria`.
 *
 * A folga base cobre o esqueleto do plano (issues, descartes, justificativas) e
 * o por-documento cobre um template ou uma cláusula longa. O teto duro existe
 * porque saída muito longa não cabe no orçamento da fatia: a partir daí o certo
 * é dividir o lote por família, não pedir mais tokens.
 */
export function planMaxTokens(itemCount: number): number {
  return Math.min(48_000, 8_000 + Math.max(itemCount, 1) * 1_600);
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
 * Roda UM degrau da escada e devolve o plano com o veredicto dos guardrails.
 *
 * Uma chamada de modelo por invocação — ver "UM degrau por invocação" no
 * cabeçalho do módulo. Quando o degrau não resolve e ainda há para onde subir, o
 * resultado volta com `accepted: false` e `nextLadder` preenchido; quem grava o
 * estado e chama de novo é o executor do run.
 *
 * Nunca escreve no banco: o run é quem persiste `libraryPlan`. Nunca "conserta"
 * um plano recusado.
 */
export async function planLibrary(
  input: PlanLibraryInput,
  options: PlanLibraryOptions = {}
): Promise<PlanLibraryResult> {
  const call = options.structured ?? runStructured;
  const ladder = buildLadder(
    options.planModel ?? INGEST_PLAN_MODEL,
    options.escalationModel ?? INGEST_ESCALATION_MODEL
  );

  const stepIndex = Math.min(
    Math.max(options.ladder?.stepIndex ?? 0, 0),
    ladder.length - 1
  );
  const attempts = [...(options.ladder?.attempts ?? [])];
  const feedback = attempts[attempts.length - 1]?.violations ?? [];
  const stepBudget = options.stepBudget ?? ladder.length;
  /** Não há degrau seguinte: nem na escada, nem no orçamento do run. */
  const lastStep = stepIndex >= ladder.length - 1 || stepBudget <= 1;

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

  options.meter?.assertWithinCap();
  const step = ladder[stepIndex];

  const result = await call<RawPlan>({
    model: step.model,
    system,
    userContent: `${digest}${operatorCommentsBlock(input.operatorComments)}${feedbackBlock(feedback)}`,
    schema: PLAN_SCHEMA,
    maxTokens: planMaxTokens(input.items.length),
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
    ...indexTruncationIssues(analysis.budget),
  ];

  const verdict = validateLibraryPlan({ plan, items, library: input.library });
  attempts.push({
    attempt: attempts.length + 1,
    model: step.model,
    effort: step.effort,
    ok: verdict.ok,
    confidence: plan.confidence,
    violations: verdict.violations,
    durationMs: result.latencyMs,
  });

  const accepted = verdict.ok && plan.confidence >= MIN_PLAN_CONFIDENCE;
  const escalated = escalatedIn(attempts, ladder);

  if (!accepted && !lastStep) {
    // Um degrau por recusa. O 2º degrau é a MESMA pergunta com as violações em
    // mãos; a partir da segunda recusa a escada já subiu para o effort maior,
    // que é onde a profundidade muda de verdade.
    //
    // Plano VÁLIDO com confiança baixa é o outro caso: não há violação a
    // devolver, então repetir no mesmo degrau não muda nada e a escada pula
    // direto para onde a profundidade sobe.
    const nextStepIndex = verdict.ok
      ? Math.max(stepIndex + 1, DEPTH_STEP_INDEX)
      : stepIndex + 1;
    return {
      plan,
      accepted: false,
      attempts,
      escalated,
      indexBudget: analysis.budget,
      nextLadder: {
        stepIndex: Math.min(nextStepIndex, ladder.length - 1),
        attempts,
      },
    };
  }

  if (!accepted) {
    plan.issues = [
      ...plan.issues,
      ...verdict.violations.map(violationToIssue),
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
  }

  return {
    plan,
    accepted,
    attempts,
    escalated,
    indexBudget: analysis.budget,
    nextLadder: null,
  };
}
