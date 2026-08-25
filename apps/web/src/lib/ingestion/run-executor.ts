/**
 * Executor do run de ingestão — quem faz o I/O que a máquina de estados descreve.
 *
 * Uma invocação = uma FATIA. O executor reivindica o run, processa alguns itens
 * do estágio corrente, troca de estágio quando o estágio esvazia, libera o claim
 * e diz ao caller se sobrou trabalho (`hasMore`). O caller — a rota `/advance`
 * ou o cron — é quem re-encadeia.
 *
 * ## Idempotência
 *
 * Nada aqui depende de "esta invocação é a primeira". Duas garantias:
 *
 * 1. **O run é reivindicado no `where`** (ver `runClaimWhere` em run-state.ts):
 *    duas invocações simultâneas, só uma processa.
 * 2. **Cada item também é reivindicado no `where`**: toda escrita de item é um
 *    `updateMany` que exige o status de ENTRADA do estágio. Reprocessar um item
 *    já extraído não sobrescreve nada — o `count` volta 0 e o executor segue.
 *
 * A segunda garantia é o que torna seguro o cron e a rota rodarem juntos: mesmo
 * que a janela de stale expire no meio de uma fatia longa e um segundo worker
 * entre, os dois não escrevem o mesmo item.
 *
 * ## Os dois pontos de julgamento
 *
 * `classifying` roda o classificador por documento e `planning` roda o planner.
 * Os dois custam IA e os dois passam pelo mesmo {@link IngestionAiMeter}: é ele
 * que grava `AIUsage`, acumula `IngestionRun.aiCostUsd` e barra a próxima
 * chamada quando o teto do lote estoura ({@link IngestionCostCapError}).
 *
 * O run atravessa o pipeline inteiro sozinho e para em `awaiting_review` — com
 * `libraryPlan` gravado, aceito ou não. Um plano RECUSADO pelos guardrails
 * também chega lá, com as issues explicando o quê: quem decide o que fazer com
 * um plano que não passou é o operador, e um run morto num estágio sem saída
 * tiraria dele essa chance.
 *
 * Os dois pontos degradam de formas DIFERENTES quando não há IA disponível, e a
 * diferença é deliberada: a classificação cai no determinístico e o lote segue
 * (ver {@link canUseLlm}); o plano não tem substituto determinístico e o run
 * para com o motivo escrito (ver `defaultPlanner`).
 *
 * A degradação da classificação vale só para falha TRANSITÓRIA (429, 5xx,
 * timeout, rede). Erro PERMANENTE — 4xx de requisição inválida, que é sempre
 * bug nosso — derruba o run: ver `classifyItem` e `runPlanner`.
 *
 * ## O plano tem um teto de TENTATIVAS, além do teto de custo
 *
 * A chamada do planner é a única do pipeline que pode morrer sem deixar rastro:
 * quando a função estoura o `maxDuration` no meio dela, a Anthropic cobra e o
 * medidor — que só grava no retorno — não vê nada. O run volta para o sweeper e
 * a chamada repete, paga e invisível. {@link MAX_PLAN_ATTEMPTS} fecha esse laço.
 */

import { prisma } from "@/lib/db/prisma";
import { extractDocx } from "@/lib/extraction/docx";
import { extractPlainText } from "@/lib/ai/ocr";
import { classifyKnowledgeUpload } from "@/lib/knowledge/upload-classifier";
import { computeSourceHash } from "@/lib/templates/upload-dedup";
import { detectPii } from "@/lib/ingestion/pii";
import {
  deterministicItemClassifier,
  parseItemPiiReport,
  summarizePii,
  type ItemClassification,
  type ItemClassifier,
} from "@/lib/ingestion/classifier";
import { createLlmItemClassifier } from "@/lib/ingestion/llm-classifier";
import {
  describeApiFailure,
  formatApiFailure,
} from "@/lib/ai/shared/api-failure";
import {
  IngestionAiMeter,
  IngestionCostCapError,
  readAiCostUsd,
} from "@/lib/ingestion/ai-budget";
import {
  buildGroupingReport,
  type GroupableItem,
  type GroupingReport,
} from "@/lib/ingestion/grouping";
import {
  planLibrary,
  type PlanAttemptRecord,
  type PlanLibraryInput,
  type PlanLibraryOptions,
  type PlanLibraryResult,
  type PlannerItem,
} from "@/lib/ingestion/planner";
import {
  batchSizeFor,
  isAutoAdvanceable,
  isRunStatus,
  itemsForSlice,
  nextRunStatus,
  runClaimWhere,
  stageProgress,
  type ItemStatus,
  type RunStatus,
} from "@/lib/ingestion/run-state";

export const PDF_MIME = "application/pdf";

/** Mesmo teto de `ingest/analyze` — um contrato inteiro cabe folgado. */
export const MAX_TEXT_CHARS = 200_000;

/** Abaixo disso a extração não produziu documento, produziu ruído. */
const MIN_TEXT_CHARS = 20;

/**
 * Orçamento de uma invocação. O `maxDuration` da rota é 300s; o executor para
 * em 240s para sobrar tempo de gravar o estado e disparar o re-encadeamento —
 * uma fatia interrompida pelo timeout da Vercel deixaria o claim preso até a
 * janela de stale.
 *
 * A folga de 60s é a mesma proporção de antes (o par era 90s/120s). Quem mantém
 * os dois números coerentes é o bloco "orçamento da fatia × maxDuration da rota"
 * de `__tests__/run-executor.test.ts`, que lê o `maxDuration` das rotas do
 * disco: mudar um sem o outro quebra o teste.
 */
export const SLICE_BUDGET_MS = Number(
  process.env.INGESTION_SLICE_BUDGET_MS ?? "240000"
);

/** Guarda contra laço infinito: nenhum run legítimo precisa de tantos passos. */
const MAX_STEPS_PER_INVOCATION = 40;

/**
 * Tempo que o estágio `planning` exige ter pela frente antes de começar.
 *
 * A chamada do planner é UMA, indivisível e lenta (Opus 4.8 com `effort: high`,
 * mais os degraus da escalação). Começá-la com 10s de orçamento significaria
 * pagar o token e perder a resposta no timeout da Vercel. Então, quando não
 * cabe, a fatia termina com o run em `planning` e a corrente reentra com os
 * 240s inteiros — `planning` está em `AUTO_ADVANCE_STATUSES` justamente para
 * isso.
 *
 * E se a chamada estourar mesmo assim, o sweeper reivindica o run e ela REPETE.
 * É por isso que {@link MAX_PLAN_ATTEMPTS} existe: repetir não é de graça.
 */
export const PLAN_MIN_BUDGET_MS = Number(
  process.env.INGESTION_PLAN_BUDGET_MS ?? "180000"
);

/**
 * Quantas vezes um run tenta PLANEJAR antes de desistir.
 *
 * A repetição parecia inofensiva ("no pior caso, repete") e não é: a Anthropic
 * cobra a chamada mesmo quando a nossa função morre antes da resposta, e o
 * medidor só grava DEPOIS do retorno. Uma chamada que sempre estoura é, então,
 * um laço infinito de chamadas pagas que não aparecem em `aiCostUsd` nem no
 * cap — o único gasto do sistema que ninguém vê nascer.
 *
 * Três tentativas: as duas primeiras cobrem instabilidade real (deploy no meio,
 * lentidão pontual do provedor); a terceira sem sucesso não é azar, é um lote
 * que não cabe no tempo, e isso não melhora repetindo.
 */
export const MAX_PLAN_ATTEMPTS = Number(
  process.env.INGESTION_PLAN_MAX_ATTEMPTS ?? "3"
);

/** Fração do orçamento a partir da qual uma chamada vira aviso no log. */
const SLOW_CALL_RATIO = 0.5;

/**
 * Assinatura de {@link planLibrary}. Existe como tipo para o teste injetar um
 * planner falso — nenhum teste pode chegar na API de verdade.
 */
export type LibraryPlanner = (
  input: PlanLibraryInput,
  options: PlanLibraryOptions
) => Promise<PlanLibraryResult>;

/** O que fica em `IngestionRun.report.planning` — a trilha da decisão. */
export interface PlanningReport {
  plannedAt: string;
  /** Passou nos guardrails E no piso de confiança. */
  accepted: boolean;
  /** Alguma tentativa saiu do degrau base (mais profundidade ou outro modelo). */
  escalated: boolean;
  confidence: number;
  attempts: PlanAttemptRecord[];
  /** Implementação que classificou os itens (`llm` ou `deterministic`). */
  classifier: string;
  /** Tempo de parede do estágio inteiro, escalação incluída. */
  durationMs: number;
}

/**
 * `IngestionRun.report.planAttempts` — o contador DURÁVEL de tentativas de
 * planejamento do RUN.
 *
 * Não confundir com `PlanningReport.attempts`, que são os degraus da escada
 * DENTRO de uma chamada bem-sucedida. Este conta quantas vezes o estágio
 * `planning` foi iniciado — inclusive as vezes em que ele não voltou.
 *
 * Vive no `report` (JSON) e não numa coluna porque é diagnóstico de um estágio
 * que já tem o resto do seu diário ali: `grouping`, `planning` e `timings` são
 * todos do mesmo tipo de informação, e uma coluna a mais custaria uma migração
 * para dar acesso indexado a um número que nenhuma consulta filtra.
 */
export interface PlanAttemptsReport {
  count: number;
  /** ISO do início da ÚLTIMA tentativa. */
  startedAt: string;
  /** Teto vigente quando a tentativa foi registrada. */
  maxAttempts: number;
}

/**
 * Cronômetro de um estágio que chama IA, acumulado ao longo do run inteiro.
 * Fica em `IngestionRun.report.timings[estágio]`.
 */
export interface StageTiming {
  calls: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

/**
 * O run gastou as tentativas de planejamento.
 *
 * Tipado pelo mesmo motivo de {@link IngestionCostCapError}: é parada
 * CONTROLADA, não crash, e o executor precisa distinguir as duas para não
 * gritar `console.error` num desfecho previsto.
 */
export class PlanAttemptLimitError extends Error {
  readonly code = "INGESTION_PLAN_ATTEMPTS" as const;
  readonly attempts: number;
  constructor(attempts: number) {
    super(
      `O planejamento deste lote foi tentado ${attempts} vezes e não coube no ` +
        `tempo da função. Cada tentativa é cobrada mesmo quando a resposta não ` +
        `chega, então o lote parou aqui em vez de repetir sem fim. O que ` +
        `costuma resolver: dividir o acervo em lotes menores (ou por tipo de ` +
        `contrato) e disparar de novo. Tudo que já foi lido, classificado e ` +
        `agrupado continua gravado.`
    );
    this.name = "PlanAttemptLimitError";
    this.attempts = attempts;
  }
}

/**
 * Dá para julgar por LLM neste ambiente?
 *
 * Lido a cada chamada, e não no load do módulo, pelo mesmo motivo de
 * `runMaxUsd`: é a alavanca do operador de plataforma e ela não pode exigir
 * deploy. Sem chave o run NÃO quebra — cai no classificador determinístico, que
 * é o que já rodava antes desta fase e sustenta o agrupamento sozinho.
 */
export function canUseLlm(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * O planner de produção — ou, sem chave, um que RECUSA.
 *
 * A classificação tem um caminho determinístico bom o bastante para o run
 * seguir sem IA; o plano não tem, e inventar um faria o operador aprovar uma
 * decisão que ninguém tomou. Então o run para com o motivo escrito, do mesmo
 * jeito que para no teto de custo — nada do que já foi lido, classificado e
 * agrupado se perde, e quem conserta é quem configura o ambiente.
 */
function defaultPlanner(): LibraryPlanner {
  if (canUseLlm()) return planLibrary;
  return async () => {
    throw new Error(
      "O plano da biblioteca depende do julgamento por IA e a chave da " +
        "Anthropic não está configurada neste ambiente. O lote parou antes da " +
        "decisão, com tudo que já foi lido e classificado preservado."
    );
  };
}

export interface AdvanceRunOptions {
  runId: string;
  /**
   * Escopo do tenant. Presente quando a chamada vem da org (rota da Central);
   * ausente na varredura do cron, que já opera sobre ids que ela mesma listou.
   */
  orgId?: string;
  /**
   * Classificador por item. Ausente, o executor escolhe: LLM quando há
   * `ANTHROPIC_API_KEY`, determinístico quando não há.
   */
  classifier?: ItemClassifier;
  /** Planner do lote. Ausente, o de produção (ver `defaultPlanner`). */
  planner?: LibraryPlanner;
  now?: Date;
  budgetMs?: number;
  /**
   * Teto de PASSOS desta invocação (uma fatia ou uma troca de estágio). Existe
   * para os testes conseguirem observar uma fatia isolada — em produção o
   * limite que manda é o orçamento de tempo, porque cada passo custa OCR.
   */
  maxSteps?: number;
}

export interface AdvanceRunResult {
  runId: string;
  /** false = outra invocação está com o run (ou ele não é avançável). */
  claimed: boolean;
  status: RunStatus | null;
  itemsTotal: number;
  itemsDone: number;
  /** Itens escritos nesta invocação. */
  processed: number;
  /** Sobrou trabalho automático — o caller deve re-encadear. */
  hasMore: boolean;
}

interface RunRow {
  id: string;
  orgId: string;
  createdBy: string | null;
  status: string;
  report: unknown;
  /** `Decimal` do Prisma — sempre pelo {@link readAiCostUsd}. */
  aiCostUsd: unknown;
}

interface ItemRow {
  id: string;
  filename: string;
  fileKind: string;
  blobUrl: string;
  sourceHash: string;
  status: ItemStatus;
  text: string | null;
  classification: unknown;
  piiReport: unknown;
}

/**
 * Avança um run em uma fatia.
 *
 * Nunca lança por falha de UM item — item quebrado vira `status: "error"` com a
 * mensagem, e o lote segue. Só uma falha do próprio run (banco fora, estado
 * corrompido) marca o run como `failed`.
 */
export async function advanceRun(
  options: AdvanceRunOptions
): Promise<AdvanceRunResult> {
  const now = options.now ?? new Date();
  const budgetMs = options.budgetMs ?? SLICE_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  // O claim vai no WHERE — é o UPDATE do Postgres que resolve a corrida entre
  // duas invocações. Ver `runClaimWhere`.
  const claim = await prisma.ingestionRun.updateMany({
    where: runClaimWhere({ runId: options.runId, orgId: options.orgId, now }),
    data: { startedAt: now },
  });
  if (claim.count === 0) {
    return {
      runId: options.runId,
      claimed: false,
      status: null,
      itemsTotal: 0,
      itemsDone: 0,
      processed: 0,
      hasMore: false,
    };
  }

  let processed = 0;
  let status: RunStatus = "queued";
  let itemsTotal = 0;
  let itemsDone = 0;

  try {
    const run = (await prisma.ingestionRun.findFirst({
      where: {
        id: options.runId,
        ...(options.orgId ? { orgId: options.orgId } : {}),
      },
      select: {
        id: true,
        orgId: true,
        createdBy: true,
        status: true,
        report: true,
        aiCostUsd: true,
      },
    })) as RunRow | null;
    if (!run) {
      return {
        runId: options.runId,
        claimed: true,
        status: null,
        itemsTotal: 0,
        itemsDone: 0,
        processed: 0,
        hasMore: false,
      };
    }
    status = isRunStatus(run.status) ? run.status : "failed";

    // `queued` não processa nada — é só o estado de repouso entre o intake e a
    // primeira invocação.
    if (status === "queued") status = "extracting";

    // Um medidor por invocação; o que atravessa invocações é `aiCostUsd`.
    const meter = new IngestionAiMeter({
      runId: run.id,
      orgId: run.orgId,
      userId: run.createdBy,
      spentUsd: readAiCostUsd(run.aiCostUsd),
    });
    const classifier =
      options.classifier ??
      (canUseLlm() ? createLlmItemClassifier({ meter }) : deterministicItemClassifier);
    const planner = options.planner ?? defaultPlanner();
    let report = asRecord(run.report);
    /** Não-nulo = esta invocação classificou algo e o cronômetro mudou. */
    let classifyTiming: StageTiming | null = null;

    const maxSteps = options.maxSteps ?? MAX_STEPS_PER_INVOCATION;
    let steps = 0;
    while (isAutoAdvanceable(status) && Date.now() < deadline && steps < maxSteps) {
      steps += 1;
      const items = await loadItems(run.id);
      itemsTotal = items.length;

      const slice = itemsForSlice(items, status, batchSizeFor(status));
      if (slice.length === 0) {
        // Estágio vazio: os dois estágios que não são item-a-item produzem seu
        // artefato aqui — `grouping` o relatório, `planning` o plano — e só
        // então avançam.
        if (status === "grouping") {
          report = await persistReport(run.id, {
            ...report,
            grouping: groupItems(items, now),
          });
        } else if (status === "planning") {
          // Não começar o que não cabe. `steps > 1` porque uma invocação que
          // ABRE em `planning` tem a fatia inteira pela frente: adiar ali seria
          // adiar para sempre, com orçamento pequeno demais configurado.
          if (steps > 1 && Date.now() + PLAN_MIN_BUDGET_MS > deadline) break;
          report = await persistPlan({
            run,
            items,
            now,
            report,
            planner,
            meter,
            classifierName: classifier.name,
          });
        }
        const next = nextRunStatus(status);
        if (!next) break;
        status = next;
        continue;
      }

      for (const item of slice) {
        if (Date.now() >= deadline) break;
        if (status === "extracting") {
          processed += await extractItem(run, item);
        } else if (status === "classifying") {
          const startedAt = Date.now();
          processed += await classifyItem(run, item, classifier);
          const durationMs = Date.now() - startedAt;
          classifyTiming = addCall(
            classifyTiming ?? readTiming(report, "classify"),
            durationMs
          );
          warnIfSlow(`a classificação de ${item.id}`, durationMs, budgetMs);
        }
      }
    }

    const finalItems = await loadItems(run.id);
    itemsTotal = finalItems.length;
    itemsDone = stageProgress(finalItems, status);

    // O cronômetro da classificação vai junto do status, e não numa escrita por
    // item: são até 25 itens por fatia, e medir não pode custar 25 UPDATEs.
    if (classifyTiming) {
      report = { ...report, timings: withTiming(report, "classify", classifyTiming) };
    }
    await prisma.ingestionRun.updateMany({
      where: { id: run.id },
      data: {
        status,
        itemsTotal,
        itemsDone,
        startedAt: null,
        ...(classifyTiming ? { report: report as object } : {}),
      },
    });

    // `grouping` e `planning` não têm itens na fatia — o que sobrou de trabalho
    // neles é o artefato que ainda não foi produzido, não uma lista.
    const hasMore =
      isAutoAdvanceable(status) &&
      (itemsForSlice(finalItems, status).length > 0 ||
        status === "grouping" ||
        status === "planning");

    return {
      runId: run.id,
      claimed: true,
      status,
      itemsTotal,
      itemsDone,
      processed,
      hasMore,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof IngestionCostCapError) {
      // Parada CONTROLADA, não crash: a mensagem do erro já diz em PT-BR qual é
      // o teto e quanto o lote gastou, e é ela que o operador lê na tela. Vira
      // `failed` porque não há como seguir sem alguém subir o teto — mas o run
      // segue íntegro e retomável, com tudo que já foi extraído no lugar.
      console.warn(`[ingestion] run ${options.runId} parou no teto de custo:`, message);
    } else if (err instanceof PlanAttemptLimitError) {
      // Também parada controlada: o run gastou as tentativas de planejamento e
      // parar é o desfecho DESEJADO, não uma falha do código.
      console.warn(
        `[ingestion] run ${options.runId} parou no teto de tentativas de plano:`,
        message
      );
    } else {
      console.error(`[ingestion] run ${options.runId} falhou:`, message);
    }
    await prisma.ingestionRun
      .updateMany({
        where: { id: options.runId },
        data: {
          status: "failed",
          error: message.slice(0, 500),
          startedAt: null,
        },
      })
      .catch(() => {});
    return {
      runId: options.runId,
      claimed: true,
      status: "failed",
      itemsTotal,
      itemsDone,
      processed,
      hasMore: false,
    };
  }
}

async function loadItems(runId: string): Promise<ItemRow[]> {
  return (await prisma.ingestionItem.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      filename: true,
      fileKind: true,
      blobUrl: true,
      sourceHash: true,
      status: true,
      text: true,
      classification: true,
      piiReport: true,
    },
  })) as ItemRow[];
}

/** `IngestionRun.report` como objeto — `null` e Json não-objeto viram `{}`. */
function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

// ────────────────────────────────────────────────────────────────────────────
// Instrumentação
// ────────────────────────────────────────────────────────────────────────────

/** O cronômetro de um estágio já gravado no report, ou null. */
function readTiming(
  report: Record<string, unknown>,
  stage: string
): StageTiming | null {
  const raw = asRecord(report.timings)[stage];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Partial<StageTiming>;
  if (typeof value.calls !== "number" || typeof value.totalMs !== "number") {
    return null;
  }
  return {
    calls: value.calls,
    totalMs: value.totalMs,
    maxMs: value.maxMs ?? 0,
    lastMs: value.lastMs ?? 0,
  };
}

/** O bloco `timings` do report com UM estágio atualizado. */
function withTiming(
  report: Record<string, unknown>,
  stage: string,
  timing: StageTiming
): Record<string, unknown> {
  return { ...asRecord(report.timings), [stage]: timing };
}

function addCall(previous: StageTiming | null, durationMs: number): StageTiming {
  return {
    calls: (previous?.calls ?? 0) + 1,
    totalMs: (previous?.totalMs ?? 0) + durationMs,
    maxMs: Math.max(previous?.maxMs ?? 0, durationMs),
    lastMs: durationMs,
  };
}

/**
 * Aviso quando uma chamada come uma fração grande demais do orçamento.
 *
 * Não interrompe nada — é o sinal que faltava para a fatia apertando aparecer
 * ANTES de virar 504 no log da Vercel, que foi como este defeito apareceu. A
 * régua é o orçamento INTEIRO, e não a fatia justa por item: o que interessa é a
 * chamada patológica, não o ritmo (um estágio lento demais já transborda sozinho
 * para a próxima invocação, que é o comportamento desenhado).
 */
function warnIfSlow(label: string, durationMs: number, budgetMs: number): void {
  if (durationMs < budgetMs * SLOW_CALL_RATIO) return;
  console.warn(
    `[ingestion] ${label} levou ${Math.round(durationMs / 1000)}s — mais de ` +
      `${Math.round(SLOW_CALL_RATIO * 100)}% do orçamento de ` +
      `${Math.round(budgetMs / 1000)}s.`
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Estágio: extract
// ────────────────────────────────────────────────────────────────────────────

/** Sniff de magic header — o content-type do browser não é confiável. */
export function sniffFileKind(buffer: Buffer): "pdf" | "docx" | null {
  if (buffer.subarray(0, 7).toString("ascii").startsWith("%PDF-1.")) return "pdf";
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return "docx";
  }
  return null;
}

async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar o arquivo`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Extrai o texto de um item e o marca `extracted`.
 *
 * É AQUI que o `sourceHash` e o `fileKind` autoritativos nascem. Os que vieram
 * do intake foram declarados pelo navegador (que tem o arquivo em mãos e é quem
 * consegue hashear sem obrigar o servidor a baixar o acervo inteiro num único
 * request) e servem só ao descarte SUGERIDO. A identidade que vale — a que
 * `ingestTemplateFromDocx` usa pro 409 — é a calculada sobre os bytes que o
 * servidor de fato leu.
 *
 * Devolve 1 quando escreveu, 0 quando outra invocação chegou antes.
 */
async function extractItem(run: RunRow, item: ItemRow): Promise<number> {
  try {
    const buffer = await fetchBlob(item.blobUrl);
    const kind = sniffFileKind(buffer);
    if (!kind) {
      return await failItem(item, "Formato não suportado — envie DOCX ou PDF.");
    }

    const text =
      kind === "pdf"
        ? await extractPlainText(buffer, PDF_MIME, {
            orgId: run.orgId,
            userId: run.createdBy,
          })
        : (await extractDocx(buffer)).text;

    if (!text || text.trim().length < MIN_TEXT_CHARS) {
      return await failItem(
        item,
        "Não foi possível extrair texto suficiente do documento."
      );
    }

    const written = await prisma.ingestionItem.updateMany({
      // O status de entrada no `where` é o claim do ITEM: se outra invocação já
      // extraiu este arquivo, este update não encontra linha e nada é
      // sobrescrito.
      where: { id: item.id, runId: run.id, status: "pending" },
      data: {
        status: "extracted",
        fileKind: kind,
        sourceHash: computeSourceHash(buffer),
        text: text.slice(0, MAX_TEXT_CHARS),
        error: null,
      },
    });
    return written.count;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await failItem(item, msg);
  }
}

async function failItem(item: ItemRow, message: string): Promise<number> {
  const written = await prisma.ingestionItem.updateMany({
    where: { id: item.id, status: item.status },
    data: { status: "error", error: message.slice(0, 500) },
  });
  return written.count;
}

// ────────────────────────────────────────────────────────────────────────────
// Estágio: classify
// ────────────────────────────────────────────────────────────────────────────

async function classifyItem(
  run: RunRow,
  item: ItemRow,
  classifier: ItemClassifier
): Promise<number> {
  const text = item.text ?? "";
  try {
    const upload = await classifyKnowledgeUpload(text, item.filename, {
      orgId: run.orgId,
      userId: run.createdBy,
    });
    const { classification, piiReport } = await classifier.classify({
      filename: item.filename,
      text,
      upload,
    });

    const written = await prisma.ingestionItem.updateMany({
      where: { id: item.id, runId: run.id, status: "extracted" },
      data: {
        status: "classified",
        classification: classification as object,
        piiReport: piiReport as object,
      },
    });
    return written.count;
  } catch (err) {
    // O teto de custo NÃO é falha de item: seguir classificando (ainda que de
    // graça, no determinístico) esconderia do operador que o lote foi
    // interrompido por dinheiro. Sobe e para o run inteiro.
    if (err instanceof IngestionCostCapError) throw err;

    const failure = describeApiFailure(err);
    if (failure.permanent) {
      // Bug NOSSO (schema inválido, modelo inexistente, parâmetro proibido,
      // chave errada). Sobe e derruba o run, em vez de cair no fallback.
      //
      // POR QUE FALHAR O RUN, e não "seguir com fallback + issue":
      //
      // 1. Um 4xx de requisição inválida atinge TODOS os itens igualmente — não
      //    é um documento estranho, é a chamada. O fallback produziria um lote
      //    inteiro classificado por heurística, que é exatamente o desfecho que
      //    passou despercebido no primeiro run em staging.
      // 2. Uma issue só apareceria no plano, e o plano é justamente o que pode
      //    sair "aceito" por cima da classificação degradada — o carimbo de
      //    sucesso apagaria o sintoma.
      // 3. `failed` não perde nada: texto extraído e itens já classificados
      //    ficam gravados, o run é retomável, e a coluna `error` (que o outer
      //    catch preenche com esta mensagem) é o que o operador lê na Central.
      //
      // Transitório continua caindo no fallback, logo abaixo: é para isso que
      // o fallback existe.
      console.error(
        `[ingestion] classificação de ${item.id} falhou por erro PERMANENTE da API:`,
        formatApiFailure(failure)
      );
      throw new Error(
        `A chamada de classificação foi recusada pela API (${formatApiFailure(failure)}). ` +
          "É um defeito da requisição, não instabilidade: o lote parou em vez de " +
          "cair no classificador determinístico e esconder o problema."
      );
    }

    // Falha TRANSITÓRIA — rate limit, 5xx, timeout, rede, ou uma resposta
    // malformada. Não perder o item por isso: o palpite determinístico sozinho
    // já sustenta o agrupamento, e é ele que rodava antes do julgamento por
    // LLM entrar — degradar para ele é degradar para o comportamento conhecido.
    console.warn(
      `[ingestion] classificação de ${item.id} caiu no fallback:`,
      formatApiFailure(failure)
    );
    const { classification, piiReport } = await deterministicItemClassifier.classify({
      filename: item.filename,
      text,
      upload: {
        kind: "template",
        confidence: 0.5,
        reason: "Classificação estrutural indisponível; palpite pelo texto.",
      },
    });
    const written = await prisma.ingestionItem.updateMany({
      where: { id: item.id, runId: run.id, status: "extracted" },
      data: {
        status: "classified",
        classification: classification as object,
        piiReport: (piiReport ?? summarizePii(detectPii(text), text)) as object,
      },
    });
    return written.count;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Estágio: group
// ────────────────────────────────────────────────────────────────────────────

function groupItems(items: readonly ItemRow[], now: Date): GroupingReport {
  const groupable: GroupableItem[] = items
    .filter((i) => i.status === "classified" && (i.text ?? "").trim().length > 0)
    .map((i) => ({
      id: i.id,
      filename: i.filename,
      text: i.text ?? "",
      familyKey: readFamilyKey(i.classification),
    }));
  return buildGroupingReport(groupable, now);
}

/**
 * Mescla um pedaço no `report` do run e grava.
 *
 * O `where` leva só o id: quem serializa esta escrita é o claim do RUN, e
 * exigir aqui o status de entrada do estágio quebraria o caso normal — o status
 * só vai para o banco no fim da fatia, então em memória o run já está adiante
 * do que a linha diz.
 */
async function persistReport(
  runId: string,
  report: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  await prisma.ingestionRun.updateMany({
    where: { id: runId },
    data: { ...extra, report: report as object },
  });
  return report;
}

/** Chave de família persistida no item; itens sem ela ficam na família vazia. */
function readFamilyKey(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const key = (raw as Partial<ItemClassification>).familyKey;
    if (typeof key === "string" && key) return key;
  }
  return "-:-:-";
}

// ────────────────────────────────────────────────────────────────────────────
// Estágio: planning
// ────────────────────────────────────────────────────────────────────────────

/** `IngestionItem.classification` cru → domínio, sem inventar campo. */
function readClassification(raw: unknown): ItemClassification | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Partial<ItemClassification>;
  return typeof value.familyKey === "string" ? (value as ItemClassification) : null;
}

/** O relatório de agrupamento gravado no run, ou null se não houver. */
function readGrouping(report: Record<string, unknown>): GroupingReport | null {
  const grouping = report.grouping;
  if (!grouping || typeof grouping !== "object" || Array.isArray(grouping)) {
    return null;
  }
  const value = grouping as Partial<GroupingReport>;
  return Array.isArray(value.families) && Array.isArray(value.groups)
    ? (grouping as GroupingReport)
    : null;
}

/**
 * Itens que o planner enxerga: todos os que têm texto, com o status real.
 *
 * O status vai junto (e o item `discarded` não é filtrado aqui) porque é assim
 * que os guardrails conseguem RECUSAR um plano que elege um descartado como
 * fonte — some com o item e a violação vira um "sourceItemId inexistente", que
 * diz menos.
 */
function toPlannerItems(items: readonly ItemRow[]): PlannerItem[] {
  return items
    .filter((i) => (i.text ?? "").trim().length > 0)
    .map((i) => ({
      id: i.id,
      filename: i.filename,
      text: i.text ?? "",
      status: i.status,
      classification: readClassification(i.classification),
      piiReport: parseItemPiiReport(i.piiReport),
    }));
}

/**
 * Chama o planner e faz a MESMA distinção de `classifyItem` entre erro nosso e
 * instabilidade do provedor.
 *
 * A diferença é que aqui não existe fallback a suprimir: o plano não tem
 * substituto determinístico e qualquer falha já derruba o run. O que faltava
 * era DEPURABILIDADE — a mensagem da API sozinha não carrega `request_id` nem o
 * tipo do erro, e foi por isso que o 400 do schema levou um run inteiro para
 * ser entendido. Erro permanente vira `console.error` com o diagnóstico
 * completo e uma mensagem que diz ao operador que o defeito é nosso.
 */
async function runPlanner(
  planner: LibraryPlanner,
  input: PlanLibraryInput,
  meter: IngestionAiMeter
): Promise<PlanLibraryResult> {
  try {
    return await planner(input, { meter });
  } catch (err) {
    if (err instanceof IngestionCostCapError) throw err;
    const failure = describeApiFailure(err);
    if (!failure.permanent) throw err;
    console.error(
      "[ingestion] o planner foi recusado por erro PERMANENTE da API:",
      formatApiFailure(failure)
    );
    throw new Error(
      `O plano da biblioteca foi recusado pela API (${formatApiFailure(failure)}). ` +
        "É um defeito da requisição, não instabilidade — repetir o run não " +
        "resolve. O lote parou com tudo que já foi lido e classificado no lugar."
    );
  }
}

/**
 * Roda o planner e grava o resultado.
 *
 * Grava o plano em `libraryPlan` mesmo quando os guardrails o RECUSARAM depois
 * da escalação. O plano recusado já vem com as issues que explicam o quê
 * (`plan_invalid`, `low_confidence`, …) e o run segue para `awaiting_review`:
 * quem decide entre corrigir, aprovar em partes ou jogar fora é o operador.
 * Deixar o run parado num estágio sem saída — ou apagar o plano — tiraria dele
 * a única informação que existe sobre o lote.
 */
async function persistPlan(args: {
  run: RunRow;
  items: readonly ItemRow[];
  now: Date;
  report: Record<string, unknown>;
  planner: LibraryPlanner;
  meter: IngestionAiMeter;
  classifierName: string;
}): Promise<Record<string, unknown>> {
  let report = args.report;
  let grouping = readGrouping(report);
  if (!grouping) {
    // Run retomado de um estado antigo (ou de um `grouping` que não chegou a
    // gravar): reconstruir é barato, determinístico e melhor que planejar sem
    // saber o que agrupa com o quê.
    grouping = groupItems(args.items, args.now);
    report = await persistReport(args.run.id, { ...report, grouping });
  }

  const spent = readPlanAttempts(report);
  if (spent >= MAX_PLAN_ATTEMPTS) throw new PlanAttemptLimitError(spent);

  // A tentativa é contada ANTES da chamada, e gravada antes de ela voltar.
  //
  // Contar depois pareceria mais natural — só que a tentativa que interessa é
  // justamente a que NÃO volta: a que estoura o `maxDuration` e mata a função
  // no meio da chamada. Essa nunca chegaria ao incremento, o contador ficaria
  // parado em zero e o sweeper repetiria a chamada (paga, e invisível ao
  // `aiCostUsd`) para sempre. O preço de contar antes é uma tentativa "gasta"
  // quando o banco cai logo depois — barato perto de um laço infinito.
  const attempt: PlanAttemptsReport = {
    count: spent + 1,
    startedAt: new Date().toISOString(),
    maxAttempts: MAX_PLAN_ATTEMPTS,
  };
  report = await persistReport(args.run.id, { ...report, planAttempts: attempt });

  const startedAt = Date.now();
  const result = await runPlanner(
    args.planner,
    { items: toPlannerItems(args.items), grouping },
    args.meter
  );
  const durationMs = Date.now() - startedAt;
  warnIfSlow("a chamada do planner", durationMs, PLAN_MIN_BUDGET_MS);

  const planning: PlanningReport = {
    plannedAt: args.now.toISOString(),
    accepted: result.accepted,
    escalated: result.escalated,
    confidence: result.plan.confidence,
    attempts: result.attempts,
    classifier: args.classifierName,
    durationMs,
  };
  return persistReport(
    args.run.id,
    {
      ...report,
      planning,
      timings: withTiming(report, "plan", addCall(readTiming(report, "plan"), durationMs)),
    },
    { libraryPlan: result.plan as object }
  );
}

/** Tentativas de planejamento já gastas por este run. Ver {@link PlanAttemptsReport}. */
function readPlanAttempts(report: Record<string, unknown>): number {
  const count = asRecord(report.planAttempts).count;
  return typeof count === "number" && count > 0 ? Math.floor(count) : 0;
}
