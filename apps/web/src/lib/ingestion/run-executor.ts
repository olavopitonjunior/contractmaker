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
 * ## Onde a Fase A2 encaixa
 *
 * O run termina esta fase em `planning`, sem `libraryPlan`. `planning` não está
 * em `AUTO_ADVANCE_STATUSES`, então nem a rota nem o cron insistem nele: o run
 * fica parado, íntegro e legível, esperando o planner. Inventar um plano
 * determinístico aqui seria pior que não ter nenhum — o operador aprovaria uma
 * decisão que ninguém tomou.
 */

import { prisma } from "@/lib/db/prisma";
import { extractDocx } from "@/lib/extraction/docx";
import { extractPlainText } from "@/lib/ai/ocr";
import { classifyKnowledgeUpload } from "@/lib/knowledge/upload-classifier";
import { computeSourceHash } from "@/lib/templates/upload-dedup";
import { detectPii } from "@/lib/ingestion/pii";
import {
  deterministicItemClassifier,
  summarizePii,
  type ItemClassification,
  type ItemClassifier,
} from "@/lib/ingestion/classifier";
import { buildGroupingReport, type GroupableItem } from "@/lib/ingestion/grouping";
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
 * Orçamento de uma invocação. O `maxDuration` da rota é 120s; o executor para
 * em 90s para sobrar tempo de gravar o estado e disparar o re-encadeamento —
 * uma fatia interrompida pelo timeout da Vercel deixaria o claim preso até a
 * janela de stale.
 */
const SLICE_BUDGET_MS = Number(process.env.INGESTION_SLICE_BUDGET_MS ?? "90000");

/** Guarda contra laço infinito: nenhum run legítimo precisa de tantos passos. */
const MAX_STEPS_PER_INVOCATION = 40;

export interface AdvanceRunOptions {
  runId: string;
  /**
   * Escopo do tenant. Presente quando a chamada vem da org (rota da Central);
   * ausente na varredura do cron, que já opera sobre ids que ela mesma listou.
   */
  orgId?: string;
  classifier?: ItemClassifier;
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
  const classifier = options.classifier ?? deterministicItemClassifier;
  const deadline = Date.now() + (options.budgetMs ?? SLICE_BUDGET_MS);

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
      select: { id: true, orgId: true, createdBy: true, status: true, report: true },
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

    const maxSteps = options.maxSteps ?? MAX_STEPS_PER_INVOCATION;
    let steps = 0;
    while (isAutoAdvanceable(status) && Date.now() < deadline && steps < maxSteps) {
      steps += 1;
      const items = await loadItems(run.id);
      itemsTotal = items.length;

      const slice = itemsForSlice(items, status, batchSizeFor(status));
      if (slice.length === 0) {
        // Estágio vazio: ou avança para o próximo, ou (grouping) produz o
        // relatório e avança.
        if (status === "grouping") {
          await persistGrouping(run, items, now);
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
          processed += await classifyItem(run, item, classifier);
        }
      }
    }

    const finalItems = await loadItems(run.id);
    itemsTotal = finalItems.length;
    itemsDone = stageProgress(finalItems, status);

    await prisma.ingestionRun.updateMany({
      where: { id: run.id },
      data: { status, itemsTotal, itemsDone, startedAt: null },
    });

    const hasMore =
      isAutoAdvanceable(status) &&
      (itemsForSlice(finalItems, status).length > 0 || status === "grouping");

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
    console.error(`[ingestion] run ${options.runId} falhou:`, message);
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
    },
  })) as ItemRow[];
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
    // A classificação pode falhar por causa do desempate por IA (rate limit do
    // Gemini). Não perder o item por isso: o palpite determinístico sozinho já
    // sustenta o agrupamento, que é o que a Fase A1 entrega.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestion] classificação de ${item.id} caiu no fallback:`, msg);
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
        piiReport: (piiReport ?? summarizePii(detectPii(text))) as object,
      },
    });
    return written.count;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Estágio: group
// ────────────────────────────────────────────────────────────────────────────

async function persistGrouping(
  run: RunRow,
  items: readonly ItemRow[],
  now: Date
): Promise<void> {
  const groupable: GroupableItem[] = items
    .filter((i) => i.status === "classified" && (i.text ?? "").trim().length > 0)
    .map((i) => ({
      id: i.id,
      filename: i.filename,
      text: i.text ?? "",
      familyKey: readFamilyKey(i.classification),
    }));

  const grouping = buildGroupingReport(groupable, now);
  const previous =
    run.report && typeof run.report === "object" && !Array.isArray(run.report)
      ? (run.report as Record<string, unknown>)
      : {};

  await prisma.ingestionRun.updateMany({
    where: { id: run.id },
    data: { report: { ...previous, grouping } as object },
  });
}

/** Chave de família persistida no item; itens sem ela ficam na família vazia. */
function readFamilyKey(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const key = (raw as Partial<ItemClassification>).familyKey;
    if (typeof key === "string" && key) return key;
  }
  return "-:-:-";
}
