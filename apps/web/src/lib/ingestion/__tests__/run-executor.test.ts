import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db/prisma";
import type { ItemStatus, RunStatus } from "@/lib/ingestion/run-state";
import { INGEST_CLASSIFY_MODEL, INGEST_PLAN_MODEL } from "@/lib/ai/shared/models";
import { IngestionCostCapError } from "@/lib/ingestion/ai-budget";
import { LIBRARY_PLAN_VERSION, type LibraryPlan } from "@/lib/ingestion/library-plan";
import type { ItemClassification } from "@/lib/ingestion/classifier";
import type { StructuredCallInput } from "@/lib/ai/shared/anthropic-structured";

/**
 * O cliente da Anthropic INTEIRO fica mockado neste arquivo. É a única garantia
 * de que nenhum caminho — nem o classificador LLM, nem o planner, nem um degrau
 * de escalação — chega na API de verdade a partir da suíte.
 */
const runStructuredMock = vi.fn();
vi.mock("@/lib/ai/shared/anthropic-structured", () => ({
  runStructured: (...args: unknown[]) => runStructuredMock(...args),
}));

const extractDocxMock = vi.fn();
vi.mock("@/lib/extraction/docx", () => ({
  extractDocx: (...args: unknown[]) => extractDocxMock(...args),
}));

const extractPlainTextMock = vi.fn();
vi.mock("@/lib/ai/ocr", () => ({
  extractPlainText: (...args: unknown[]) => extractPlainTextMock(...args),
}));

const classifyMock = vi.fn();
vi.mock("@/lib/knowledge/upload-classifier", () => ({
  classifyKnowledgeUpload: (...args: unknown[]) => classifyMock(...args),
}));

import {
  advanceRun,
  MAX_PLAN_STEPS,
  PLAN_MIN_BUDGET_MS,
  SLICE_BUDGET_MS,
  type AdvanceRunOptions,
  type AdvanceRunResult,
  type LibraryPlanner,
  type PlanningReport,
  type StageTiming,
} from "@/lib/ingestion/run-executor";
import {
  MAX_INDEXED_BLOCKS,
  PLAN_LADDER_STEPS,
  type IndexBudgetReport,
  type PlanLadderState,
} from "@/lib/ingestion/planner";
import type { PlanViolation } from "@/lib/ingestion/plan-guardrails";
import { RUN_STALE_MS } from "@/lib/ingestion/run-state";

// ────────────────────────────────────────────────────────────────────────────
// Harness: um banco em memória que HONRA o `where` dos updateMany.
//
// Um mock que sempre devolvesse `{ count: 1 }` esconderia justamente o que
// precisa ser testado — a corrida entre duas invocações e o claim por item são
// decididos pelo `where`, não pelo código em volta dele.
// ────────────────────────────────────────────────────────────────────────────

interface FakeRun {
  id: string;
  orgId: string;
  createdBy: string | null;
  status: RunStatus;
  startedAt: Date | null;
  itemsTotal: number;
  itemsDone: number;
  report: unknown;
  libraryPlan: unknown;
  aiCostUsd: unknown;
  error: string | null;
}

interface FakeItem {
  id: string;
  runId: string;
  filename: string;
  fileKind: string;
  blobUrl: string;
  sourceHash: string;
  status: ItemStatus;
  text: string | null;
  classification: unknown;
  piiReport: unknown;
  error: string | null;
  createdAt: Date;
}

let runs: FakeRun[] = [];
let items: FakeItem[] = [];

function matchRun(run: FakeRun, where: Record<string, unknown>): boolean {
  if (where.id && where.id !== run.id) return false;
  if (where.orgId && where.orgId !== run.orgId) return false;
  const status = where.status as { in?: string[] } | undefined;
  if (status?.in && !status.in.includes(run.status)) return false;
  const or = where.OR as
    | Array<{ startedAt: null | { lt: Date } }>
    | undefined;
  if (or) {
    const free = run.startedAt === null;
    const stale =
      run.startedAt !== null &&
      or.some(
        (c) =>
          c.startedAt !== null &&
          typeof c.startedAt === "object" &&
          run.startedAt!.getTime() < c.startedAt.lt.getTime()
      );
    if (!free && !stale) return false;
  }
  return true;
}

function installHarness(): void {
  const runModel = prisma.ingestionRun as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  const itemModel = prisma.ingestionItem as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  >;

  runModel.updateMany.mockImplementation(
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hits = runs.filter((r) => matchRun(r, where));
      for (const run of hits) Object.assign(run, data);
      return { count: hits.length };
    }
  );
  runModel.findFirst.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) =>
      runs.find(
        (r) =>
          (!where.id || where.id === r.id) &&
          (!where.orgId || where.orgId === r.orgId)
      ) ?? null
  );
  itemModel.findMany.mockImplementation(
    async ({ where }: { where: { runId: string } }) =>
      items.filter((i) => i.runId === where.runId)
  );
  itemModel.updateMany.mockImplementation(
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hits = items.filter(
        (i) =>
          (!where.id || where.id === i.id) &&
          (!where.runId || where.runId === i.runId) &&
          (!where.status || where.status === i.status)
      );
      for (const item of hits) Object.assign(item, data);
      return { count: hits.length };
    }
  );
}

function seed(itemCount: number, status: RunStatus = "queued"): void {
  runs = [
    {
      id: "run-1",
      orgId: "org-1",
      createdBy: "user-1",
      status,
      startedAt: null,
      itemsTotal: itemCount,
      itemsDone: 0,
      report: null,
      libraryPlan: null,
      aiCostUsd: null,
      error: null,
    },
  ];
  items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i}`,
    runId: "run-1",
    filename: `contrato-${i}.docx`,
    fileKind: "docx",
    blobUrl: `https://s.public.blob.vercel-storage.com/ingestion/org-1/contrato-${i}.docx`,
    sourceHash: "a".repeat(64),
    status: "pending" as ItemStatus,
    text: null,
    classification: null,
    piiReport: null,
    error: null,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
  }));
}

const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(60).fill(0x41)]);

const CONTRATO = [
  "INSTRUMENTO PARTICULAR DE CONTRATO DE LOCAÇÃO RESIDENCIAL",
  "CLÁUSULA PRIMEIRA - DO OBJETO. A locação recai sobre o imóvel residencial adiante descrito.",
  "CLÁUSULA SEGUNDA - DA GARANTIA. A locação é garantida por fiador solidário e principal pagador.",
  "E por estarem assim justos e contratados, firmam o presente em duas vias de igual teor.",
].join("\n");

// ────────────────────────────────────────────────────────────────────────────
// Respostas do modelo — cruas, como a API as devolveria.
// ────────────────────────────────────────────────────────────────────────────

const RAW_CLASSIFICATION = {
  docType: "contrato_locacao",
  subOption: "residencial",
  modalidade: "locacao",
  garantiaTipo: "fiador",
  provider: null,
  isFilledInstance: false,
  piiEntities: [],
  confidence: 0.92,
  reason: "Contrato de locação residencial garantido por fiador.",
};

function rawPlan(sourceItemId = "item-0") {
  return {
    templates: [
      {
        sourceItemId,
        name: "Locação residencial — fiador",
        modalidade: "locacao",
        matchCriteria: { garantia: "fiador" },
        rationale: "Minuta completa, sem dados de cliente.",
      },
    ],
    clauses: [],
    discards: [],
    issues: [],
    confidence: 0.88,
  };
}

/**
 * Uma falha da API com a MESMA forma que o SDK 0.30 entrega — `status`,
 * `error.error.type` e `request_id`. É por esses campos que o executor decide
 * entre fallback e parada, então o duplo tem de carregá-los.
 */
function apiError(status: number, errorType: string, message: string): Error {
  const err = new Error(message) as Error & Record<string, unknown>;
  err.status = status;
  err.request_id = "req_teste";
  err.error = { type: "error", error: { type: errorType, message } };
  return err;
}

function structuredResult(model: string, data: unknown) {
  return {
    data,
    model,
    usage: {
      promptTokens: 4_000,
      completionTokens: 800,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    latencyMs: 1_200,
  };
}

/** Índice sem corte — o caso normal, e o que o planner falso devolve. */
function fullIndexBudget(): IndexBudgetReport {
  return {
    limit: MAX_INDEXED_BLOCKS,
    indexed: 0,
    dropped: 0,
    truncated: false,
    families: [],
    droppedItemIds: [],
  };
}

/** Um plano injetável — o caminho que não passa por modelo nenhum. */
function plannerReturning(result: {
  plan: LibraryPlan;
  accepted: boolean;
  escalated?: boolean;
  /** Atraso da chamada, para os testes de instrumentação medirem algo. */
  delayMs?: number;
}): LibraryPlanner {
  return vi.fn(async () => {
    if (result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }
    return {
      plan: result.plan,
      accepted: result.accepted,
      escalated: result.escalated ?? false,
      attempts: [
        {
          attempt: 1,
          model: INGEST_PLAN_MODEL,
          effort: "high" as const,
          ok: result.accepted,
          confidence: result.plan.confidence,
          violations: [],
          durationMs: result.delayMs ?? 0,
        },
      ],
      indexBudget: fullIndexBudget(),
      nextLadder: null,
    };
  });
}

/**
 * Um planner de escada: cada degrau devolve o que a lista mandar, e a escada
 * avança sozinha como a de verdade. É o que permite observar o pipeline dando
 * UM degrau por invocação sem tocar em modelo nenhum.
 */
function ladderPlanner(
  steps: ReadonlyArray<{ plan: LibraryPlan; accepted: boolean; violations?: PlanViolation[] }>
): LibraryPlanner {
  return vi.fn(async (_input, options) => {
    const ladder = options.ladder ?? { stepIndex: 0, attempts: [] };
    const step = steps[Math.min(ladder.stepIndex, steps.length - 1)];
    const attempts = [
      ...ladder.attempts,
      {
        attempt: ladder.attempts.length + 1,
        model: INGEST_PLAN_MODEL,
        effort: "high" as const,
        ok: step.accepted,
        confidence: step.plan.confidence,
        violations: step.violations ?? [],
        durationMs: 1,
      },
    ];
    const nextIndex = ladder.stepIndex + 1;
    const exhausted =
      step.accepted ||
      nextIndex >= PLAN_LADDER_STEPS ||
      (options.stepBudget ?? PLAN_LADDER_STEPS) <= 1;
    return {
      plan: step.plan,
      accepted: step.accepted,
      escalated: ladder.stepIndex > 0,
      attempts,
      indexBudget: fullIndexBudget(),
      nextLadder: exhausted ? null : { stepIndex: nextIndex, attempts },
    };
  });
}

/** A violação que o degrau 1 registra nos testes da escada. */
const VIOLACAO: PlanViolation = {
  kind: "missing_garantia_criteria",
  itemId: "item-0",
  detail: "O modelo de locação não diz qual garantia ele atende.",
};

function emptyPlan(confidence = 0.9): LibraryPlan {
  return {
    version: LIBRARY_PLAN_VERSION,
    templates: [],
    clauses: [],
    discards: [],
    issues: [],
    confidence,
  };
}

/** Roda o run até ele parar de pedir re-encadeamento. */
async function drain(
  options: Partial<AdvanceRunOptions> = {}
): Promise<AdvanceRunResult> {
  let result = await advanceRun({ runId: "run-1", orgId: "org-1", ...options });
  for (let i = 0; i < 12 && result.hasMore; i++) {
    result = await advanceRun({ runId: "run-1", orgId: "org-1", ...options });
  }
  return result;
}

/** As operações de IA que chegaram ao `recordAIUsage` nesta execução. */
function recordedOperations(): string[] {
  const create = prisma.aIUsage.create as unknown as ReturnType<typeof vi.fn>;
  return create.mock.calls.map(
    (call) => (call[0] as { data: { operation: string } }).data.operation
  );
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  installHarness();
  process.env.ANTHROPIC_API_KEY = "test-key";
  runStructuredMock.mockImplementation(async (input: StructuredCallInput) =>
    input.model === INGEST_CLASSIFY_MODEL
      ? structuredResult(INGEST_CLASSIFY_MODEL, RAW_CLASSIFICATION)
      : structuredResult(input.model, rawPlan())
  );
  extractDocxMock.mockResolvedValue({ text: CONTRATO, html: "" });
  extractPlainTextMock.mockResolvedValue(CONTRATO);
  classifyMock.mockResolvedValue({
    kind: "template",
    confidence: 0.9,
    reason: "Contrato completo.",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => DOCX_BYTES.buffer.slice(0),
    }))
  );
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe("advanceRun — fatiamento", () => {
  it("extrai no máximo 5 itens por passo e sinaliza que sobrou trabalho", async () => {
    seed(7);
    const first = await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });

    expect(first.claimed).toBe(true);
    expect(first.status).toBe("extracting");
    expect(first.processed).toBe(5);
    expect(items.filter((i) => i.status === "extracted")).toHaveLength(5);
    expect(items.filter((i) => i.status === "pending")).toHaveLength(2);
    expect(first.hasMore).toBe(true);
  });

  it("libera o claim ao fim da fatia — o run não fica preso", async () => {
    seed(7);
    await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });
    expect(runs[0].startedAt).toBeNull();
  });

  it("a fatia seguinte pega só o que sobrou — nenhum item é reextraído", async () => {
    seed(7);
    await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });
    const second = await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });

    expect(second.processed).toBe(2);
    expect(items.every((i) => i.status === "extracted")).toBe(true);
    expect(extractDocxMock).toHaveBeenCalledTimes(7);
  });

  it("estágio vazio é o gatilho da troca de estágio", async () => {
    seed(2);
    await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });
    const transition = await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });
    expect(transition.status).toBe("classifying");
    expect(transition.processed).toBe(0);
  });

  it("percorre o pipeline inteiro e para em awaiting_review", async () => {
    seed(3);
    const result = await drain();

    expect(result.status).toBe("awaiting_review");
    expect(result.hasMore).toBe(false);
    expect(runs[0].status).toBe("awaiting_review");
    const report = runs[0].report as { grouping?: { families: unknown[] } };
    expect(report.grouping).toBeTruthy();
    expect(report.grouping!.families.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === "classified")).toBe(true);
  });

  it("itemsDone acompanha o estágio corrente", async () => {
    seed(7);
    const first = await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });
    expect(first.itemsTotal).toBe(7);
    expect(first.itemsDone).toBe(5);
    expect(runs[0].itemsDone).toBe(5);
  });
});

describe("advanceRun — claim entre invocações concorrentes", () => {
  it("duas invocações simultâneas: só uma processa", async () => {
    seed(7);
    const [a, b] = await Promise.all([
      advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 }),
      advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 }),
    ]);

    const claimed = [a, b].filter((r) => r.claimed);
    expect(claimed).toHaveLength(1);
    // A perdedora não escreve nada e não some com o run.
    const lost = [a, b].find((r) => !r.claimed)!;
    expect(lost.processed).toBe(0);
    expect(lost.status).toBeNull();
  });

  it("a fatia nunca é processada duas vezes, mesmo com duas invocações", async () => {
    seed(7);
    await Promise.all([
      advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 }),
      advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 }),
    ]);
    expect(items.filter((i) => i.status === "extracted")).toHaveLength(5);
    expect(extractDocxMock).toHaveBeenCalledTimes(5);
  });

  it("claim vencido é retomável — worker morto não trava o lote", async () => {
    seed(3, "extracting");
    runs[0].startedAt = new Date(Date.now() - RUN_STALE_MS - 60_000);

    const result = await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });
    expect(result.claimed).toBe(true);
    expect(result.processed).toBe(3);
  });

  it("claim recente bloqueia a segunda invocação", async () => {
    seed(3, "extracting");
    runs[0].startedAt = new Date(Date.now() - 1_000);

    const result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    expect(result.claimed).toBe(false);
    expect(extractDocxMock).not.toHaveBeenCalled();
  });

  it("run em awaiting_review não é reivindicado — espera gente", async () => {
    seed(1, "awaiting_review");
    const result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    expect(result.claimed).toBe(false);
    expect(runs[0].status).toBe("awaiting_review");
  });

  it("planning com claim vencido é retomável — a chamada do planner repete", async () => {
    // É o caso que motiva `planning` estar em AUTO_ADVANCE_STATUSES: a chamada
    // é única e longa, então é a que mais morre no timeout da função.
    seed(2, "planning");
    for (const item of items) {
      item.status = "classified";
      item.text = CONTRATO;
      item.classification = { familyKey: "contrato_locacao:locacao:fiador" };
    }
    runs[0].startedAt = new Date(Date.now() - RUN_STALE_MS - 60_000);

    const result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    expect(result.claimed).toBe(true);
    expect(result.status).toBe("awaiting_review");
    expect(runs[0].libraryPlan).toBeTruthy();
  });
});

describe("advanceRun — multi-tenant", () => {
  it("orgId de outra imobiliária não reivindica o run", async () => {
    seed(3);
    const result = await advanceRun({ runId: "run-1", orgId: "org-2" });
    expect(result.claimed).toBe(false);
    expect(items.every((i) => i.status === "pending")).toBe(true);
  });

  it("chamada interna (cron) avança sem orgId", async () => {
    seed(3);
    const result = await advanceRun({ runId: "run-1", maxSteps: 1 });
    expect(result.claimed).toBe(true);
    expect(result.processed).toBe(3);
  });
});

describe("advanceRun — falhas de item", () => {
  it("arquivo ilegível vira item em erro e o lote segue", async () => {
    seed(3);
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
    );

    const result = await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });
    expect(result.processed).toBe(3);
    expect(items.filter((i) => i.status === "error")).toHaveLength(1);
    expect(items.filter((i) => i.status === "extracted")).toHaveLength(2);
    expect(items.find((i) => i.status === "error")!.error).toContain("404");
  });

  it("formato não suportado é erro de item, não do run", async () => {
    seed(1);
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("nada disso").buffer,
      })
    );

    const result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    expect(items[0].status).toBe("error");
    expect(items[0].error).toContain("DOCX ou PDF");
    expect(result.status).not.toBe("failed");
  });

  it("PDF vai pro OCR, DOCX vai pro mammoth", async () => {
    seed(1);
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          new TextEncoder().encode(`%PDF-1.7\n${CONTRATO}`).buffer,
      })
    );

    await advanceRun({ runId: "run-1", orgId: "org-1" });
    expect(extractPlainTextMock).toHaveBeenCalledTimes(1);
    expect(extractDocxMock).not.toHaveBeenCalled();
    expect(items[0].fileKind).toBe("pdf");
  });

  it("o sourceHash autoritativo é recalculado sobre os bytes lidos pelo servidor", async () => {
    seed(1);
    await advanceRun({ runId: "run-1", orgId: "org-1" });
    // O hash declarado no intake era "aaaa…"; o servidor sobrescreveu.
    expect(items[0].sourceHash).not.toBe("a".repeat(64));
    expect(items[0].sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("advanceRun — idempotência", () => {
  it("reprocessar um run já classificado não reescreve item nenhum", async () => {
    seed(2);
    await drain();
    const snapshot = JSON.parse(JSON.stringify(items));
    const extractCalls = extractDocxMock.mock.calls.length;

    // O run está em `awaiting_review`: nem a rota nem o cron o reivindicam.
    const again = await advanceRun({ runId: "run-1", orgId: "org-1" });
    expect(again.claimed).toBe(false);
    expect(extractDocxMock.mock.calls.length).toBe(extractCalls);
    expect(JSON.parse(JSON.stringify(items))).toEqual(snapshot);
  });

  it("itens descartados no intake ficam fora de toda fatia", async () => {
    seed(3);
    items[0].status = "discarded";

    await drain();

    expect(items[0].status).toBe("discarded");
    expect(items[0].text).toBeNull();
    expect(extractDocxMock).toHaveBeenCalledTimes(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Julgamento por LLM
// ────────────────────────────────────────────────────────────────────────────

describe("advanceRun — classificador por LLM", () => {
  it("com ANTHROPIC_API_KEY o classificador padrão é o LLM", async () => {
    seed(2);
    await drain();

    const modelos = runStructuredMock.mock.calls.map(
      (c) => (c[0] as StructuredCallInput).model
    );
    expect(modelos.filter((m) => m === INGEST_CLASSIFY_MODEL)).toHaveLength(2);
    for (const item of items) {
      expect((item.classification as ItemClassification).via).toBe("llm");
    }
    const report = runs[0].report as { planning?: PlanningReport };
    expect(report.planning?.classifier).toBe("llm");
  });

  it("sem ANTHROPIC_API_KEY cai no determinístico e o run NÃO quebra", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    seed(2);
    // O planner é injetado porque ele não tem substituto determinístico — o que
    // este teste prova é que a CLASSIFICAÇÃO degrada sem derrubar o lote.
    const planner = plannerReturning({ plan: emptyPlan(), accepted: true });

    const result = await drain({ planner });

    expect(result.status).toBe("awaiting_review");
    expect(runs[0].error).toBeNull();
    for (const item of items) {
      expect((item.classification as ItemClassification).via).toBe("deterministic");
    }
    // Nenhuma chamada de classificação saiu.
    expect(runStructuredMock).not.toHaveBeenCalled();
    const report = runs[0].report as { planning?: PlanningReport };
    expect(report.planning?.classifier).toBe("deterministic");
  });

  it("sem chave o PLANO para o run com o motivo escrito — não inventa plano", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    seed(2);

    const result = await drain();

    expect(result.status).toBe("failed");
    expect(runs[0].libraryPlan).toBeNull();
    expect(runs[0].error).toContain("chave da Anthropic");
    // O que já foi lido e classificado continua no lugar.
    expect(items.every((i) => i.status === "classified")).toBe(true);
  });

  it("falha TRANSITÓRIA da chamada de classificação não perde o item — vira determinístico", async () => {
    seed(2);
    runStructuredMock.mockImplementation(async (input: StructuredCallInput) => {
      if (input.model === INGEST_CLASSIFY_MODEL) {
        throw apiError(429, "rate_limit_error", "429 rate limit");
      }
      return structuredResult(input.model, rawPlan());
    });

    const result = await drain();

    expect(result.status).toBe("awaiting_review");
    for (const item of items) {
      expect(item.status).toBe("classified");
      expect((item.classification as ItemClassification).via).toBe("deterministic");
    }
  });

  it("erro de rede continua caindo no fallback", async () => {
    seed(2);
    runStructuredMock.mockImplementation(async (input: StructuredCallInput) => {
      if (input.model === INGEST_CLASSIFY_MODEL) throw new Error("fetch failed");
      return structuredResult(input.model, rawPlan());
    });

    const result = await drain();

    expect(result.status).toBe("awaiting_review");
    for (const item of items) {
      expect((item.classification as ItemClassification).via).toBe("deterministic");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// O bug que o fallback escondeu no primeiro run em staging: um 400 de schema
// inválido classificou os 11 itens como `deterministic` e ninguém percebeu.
// ────────────────────────────────────────────────────────────────────────────

describe("advanceRun — erro PERMANENTE da API não vira fallback silencioso", () => {
  const SCHEMA_400 =
    "output_config.format.schema: Invalid schema: Enum value 'fiador' does not " +
    "match declared type '['string', 'null']'";

  it("o 400 da classificação derruba o run em vez de degradar", async () => {
    seed(2);
    runStructuredMock.mockImplementation(async (input: StructuredCallInput) => {
      if (input.model === INGEST_CLASSIFY_MODEL) {
        throw apiError(400, "invalid_request_error", SCHEMA_400);
      }
      return structuredResult(input.model, rawPlan());
    });

    const result = await drain();

    expect(result.status).toBe("failed");
    expect(runs[0].status).toBe("failed");
    // Nenhum item foi carimbado como classificado por heurística.
    expect(
      items.filter(
        (i) => (i.classification as ItemClassification | null)?.via === "deterministic"
      )
    ).toHaveLength(0);
    expect(runs[0].libraryPlan).toBeNull();
    // O operador precisa ler o que a API disse, com o rastro para depurar.
    expect(runs[0].error).toContain("status=400");
    expect(runs[0].error).toContain("invalid_request_error");
    expect(runs[0].error).toContain("request_id=req_teste");
    // Parada controlada: o claim é liberado.
    expect(runs[0].startedAt).toBeNull();
  });

  it("401 de chave errada também para o lote", async () => {
    seed(2);
    runStructuredMock.mockImplementation(async () => {
      throw apiError(401, "authentication_error", "invalid x-api-key");
    });

    const result = await drain();

    expect(result.status).toBe("failed");
    expect(runs[0].error).toContain("status=401");
  });

  it("o 400 do planner falha o run com o diagnóstico completo", async () => {
    seed(2);
    runStructuredMock.mockImplementation(async (input: StructuredCallInput) => {
      if (input.model === INGEST_CLASSIFY_MODEL) {
        return structuredResult(INGEST_CLASSIFY_MODEL, RAW_CLASSIFICATION);
      }
      throw apiError(400, "invalid_request_error", SCHEMA_400);
    });

    const result = await drain();

    expect(result.status).toBe("failed");
    expect(runs[0].libraryPlan).toBeNull();
    expect(runs[0].error).toContain("recusado pela API");
    expect(runs[0].error).toContain("request_id=req_teste");
    // O que já foi classificado por LLM continua no lugar — o run é retomável.
    expect(items.every((i) => i.status === "classified")).toBe(true);
  });

  it("o teto de custo segue relançado, e não é confundido com erro da API", async () => {
    seed(2);
    const classifier = {
      name: "llm",
      classify: vi.fn(async () => {
        throw new IngestionCostCapError(5.4321, 5);
      }),
    };

    const result = await drain({ classifier });

    expect(result.status).toBe("failed");
    expect(runs[0].error).toContain("teto de custo de IA deste lote");
    // A mensagem do teto chega inteira, sem o embrulho de "recusado pela API".
    expect(runs[0].error).not.toContain("recusado pela API");
  });

  it("o teto de custo no planner também segue relançado sem embrulho", async () => {
    seed(2);
    const planner: LibraryPlanner = vi.fn(async () => {
      throw new IngestionCostCapError(5.4321, 5);
    });

    const result = await drain({ planner });

    expect(result.status).toBe("failed");
    expect(runs[0].error).toContain("teto de custo de IA deste lote");
    expect(runs[0].error).not.toContain("recusado pela API");
  });
});

describe("advanceRun — estágio planning", () => {
  it("o plano aceito é gravado em libraryPlan e o run vai a awaiting_review", async () => {
    seed(2);
    const result = await drain();

    expect(result.status).toBe("awaiting_review");
    const plan = runs[0].libraryPlan as LibraryPlan;
    expect(plan.version).toBe(LIBRARY_PLAN_VERSION);
    expect(plan.templates.map((t) => t.sourceItemId)).toEqual(["item-0"]);
    const report = runs[0].report as { planning?: PlanningReport };
    expect(report.planning?.accepted).toBe(true);
    expect(report.planning?.attempts.length).toBeGreaterThan(0);
  });

  it("o planner recebe os itens com texto, classificação e piiReport, e o agrupamento do report", async () => {
    seed(2);
    const planner = plannerReturning({ plan: emptyPlan(), accepted: true });
    await drain({ planner });

    const [input] = (planner as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const typed = input as {
      items: Array<{ id: string; text: string; classification: unknown; piiReport: unknown }>;
      grouping: { families: unknown[] };
    };
    expect(typed.items).toHaveLength(2);
    expect(typed.items[0].text).toContain("CONTRATO DE LOCAÇÃO");
    expect(typed.items[0].classification).toBeTruthy();
    expect(typed.items[0].piiReport).toBeTruthy();
    // É o MESMO agrupamento que ficou persistido no run.
    const report = runs[0].report as { grouping: { families: unknown[] } };
    expect(typed.grouping.families).toEqual(report.grouping.families);
  });

  it("plano RECUSADO também chega a awaiting_review, com as issues visíveis", async () => {
    seed(2);
    const recusado: LibraryPlan = {
      ...emptyPlan(0.45),
      issues: [
        {
          itemId: "item-0",
          kind: "plan_invalid",
          detail: "O modelo aponta para um arquivo que não está neste lote.",
        },
      ],
    };
    const planner = plannerReturning({
      plan: recusado,
      accepted: false,
      escalated: true,
    });

    const result = await drain({ planner });

    // Nunca morrer em silêncio num estado sem saída: quem decide é o operador.
    expect(result.status).toBe("awaiting_review");
    expect(runs[0].error).toBeNull();
    const plan = runs[0].libraryPlan as LibraryPlan;
    expect(plan.issues.map((i) => i.kind)).toContain("plan_invalid");
    const report = runs[0].report as { planning?: PlanningReport };
    expect(report.planning?.accepted).toBe(false);
    expect(report.planning?.escalated).toBe(true);
  });

  it("sem orçamento para a chamada, a fatia termina em planning e pede re-encadeamento", async () => {
    seed(2, "grouping");
    for (const item of items) {
      item.status = "classified";
      item.text = CONTRATO;
      item.classification = { familyKey: "contrato_locacao:locacao:fiador" };
    }
    const planner = plannerReturning({ plan: emptyPlan(), accepted: true });

    const parcial = await advanceRun({
      runId: "run-1",
      orgId: "org-1",
      planner,
      budgetMs: 1_000,
    });

    expect(parcial.status).toBe("planning");
    expect(parcial.hasMore).toBe(true);
    expect(planner).not.toHaveBeenCalled();
    // O claim foi liberado — o run não fica preso esperando a janela de stale.
    expect(runs[0].startedAt).toBeNull();

    const completo = await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    expect(completo.status).toBe("awaiting_review");
    expect(planner).toHaveBeenCalledTimes(1);
  });
});

describe("advanceRun — custo de IA", () => {
  it("as duas etapas acumulam em aiCostUsd e chegam ao recordAIUsage", async () => {
    seed(2);
    await drain();

    expect(Number(runs[0].aiCostUsd)).toBeGreaterThan(0);
    const ops = recordedOperations();
    expect(ops.filter((o) => o === "ingest_classify")).toHaveLength(2);
    expect(ops).toContain("ingest_plan");
  });

  it("o gasto de uma invocação anterior entra no medidor da seguinte", async () => {
    seed(2);
    // Uma fatia que para logo depois de classificar: o gasto vive só na coluna.
    const fatia = await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 3 });
    expect(fatia.status).toBe("classifying");
    const parcial = Number(runs[0].aiCostUsd);
    expect(parcial).toBeGreaterThan(0);

    await drain();
    expect(Number(runs[0].aiCostUsd)).toBeGreaterThan(parcial);
  });

  it("teto estourado na classificação para o run com mensagem legível", async () => {
    seed(2);
    const classifier = {
      name: "llm",
      classify: vi.fn(async () => {
        throw new IngestionCostCapError(5.4321, 5);
      }),
    };

    const result = await drain({ classifier });

    expect(result.status).toBe("failed");
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toContain("teto de custo de IA deste lote");
    expect(runs[0].error).toContain("US$ 5.00");
    expect(runs[0].error).toContain("US$ 5.4321");
    // Parada controlada: o claim é liberado, nada fica preso.
    expect(runs[0].startedAt).toBeNull();
  });

  it("teto estourado no plano para o run com mensagem legível", async () => {
    seed(2);
    const planner: LibraryPlanner = vi.fn(async () => {
      throw new IngestionCostCapError(5.4321, 5);
    });

    const result = await drain({ planner });

    expect(result.status).toBe("failed");
    expect(runs[0].error).toContain("teto de custo de IA deste lote");
    expect(runs[0].libraryPlan).toBeNull();
  });
});

/** Um run parado em `planning`, com tudo pronto para a chamada. */
function seedPlanning(): void {
  seed(2, "planning");
  for (const item of items) {
    item.status = "classified";
    item.text = CONTRATO;
    item.classification = { familyKey: "contrato_locacao:locacao:fiador" };
  }
}

function planning(): PlanningReport | undefined {
  return (runs[0].report as { planning?: PlanningReport }).planning;
}

// ────────────────────────────────────────────────────────────────────────────
// A escada em degraus
//
// Um degrau é uma chamada de ~147s contra os 300s de `maxDuration` da rota:
// dois não cabem numa invocação. O estágio `planning` passa a fatiar por
// DEGRAU, como os outros fatiam por item.
// ────────────────────────────────────────────────────────────────────────────

describe("advanceRun — a escada do planner, um degrau por invocação", () => {
  it("degrau recusado grava as violações, devolve hasMore e NÃO grava o plano", async () => {
    seedPlanning();
    const planner = ladderPlanner([
      { plan: emptyPlan(0.5), accepted: false, violations: [VIOLACAO] },
      { plan: emptyPlan(), accepted: true },
    ]);

    const primeira = await advanceRun({ runId: "run-1", orgId: "org-1", planner });

    expect(planner).toHaveBeenCalledTimes(1);
    expect(primeira.status).toBe("planning");
    expect(primeira.hasMore).toBe(true);
    // O claim foi liberado — a corrente reentra sem esperar a janela de stale.
    expect(runs[0].startedAt).toBeNull();
    // Um degrau intermediário não é o plano do lote.
    expect(runs[0].libraryPlan).toBeNull();
    // Mas o que ele propôs de errado fica GRAVADO — é o ganho de persistir a
    // escada: antes, a função morria no degrau 2 e levava isto junto.
    expect(planning()?.attempts).toHaveLength(1);
    expect(planning()?.attempts[0].violations[0].kind).toBe(
      "missing_garantia_criteria"
    );
    expect(planning()?.nextStepIndex).toBe(1);
    expect(planning()?.accepted).toBe(false);
  });

  it("FANOUT: famílias diferentes viram escadas paralelas e o merge deduplica cláusula", async () => {
    seedPlanning();
    items[0].classification = {
      familyKey: "contrato_locacao:locacao:seguro_fianca",
      modalidade: "locacao",
    };
    items[1].classification = {
      familyKey: "contrato_locacao:locacao_comercial:seguro_fianca",
      modalidade: "locacao_comercial",
    };

    const clausePorto = (content: string, title: string) => ({
      slot: "garantia" as const,
      value: "seguro_fianca",
      provider: "Porto Seguro",
      title,
      content,
      sourceItemId: items[0].id,
      tags: ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"],
      rationale: "",
    });

    const inputs: Array<{ itemIds: string[] }> = [];
    const planner: LibraryPlanner = vi.fn(async (input) => {
      inputs.push({ itemIds: input.items.map((i) => i.id) });
      const comercial = input.items.some(
        (i) => i.classification?.modalidade === "locacao_comercial"
      );
      return {
        plan: emptyPlan(comercial ? 0.8 : 0.95),
        accepted: true,
        escalated: false,
        attempts: [],
        indexBudget: {
          limit: 100,
          indexed: 1,
          dropped: 0,
          truncated: false,
          families: [],
          droppedItemIds: [],
        },
        nextLadder: null,
      };
    });
    // Injeta uma cláusula igual nos dois planos via wrapper.
    const withClauses: LibraryPlanner = vi.fn(async (input, options) => {
      const result = await planner(input, options);
      const comercial = input.items.some(
        (i) => i.classification?.modalidade === "locacao_comercial"
      );
      return {
        ...result,
        plan: {
          ...result.plan,
          clauses: [
            comercial
              ? clausePorto("Curta.", "Porto (comercial)")
              : clausePorto("Redação bem mais completa e longa.", "Porto Seguro"),
          ],
        },
      };
    });

    const result = await advanceRun({ runId: "run-1", orgId: "org-1", planner: withClauses });

    // As DUAS famílias rodaram na MESMA invocação (em paralelo).
    expect(withClauses).toHaveBeenCalledTimes(2);
    expect(inputs.map((i) => i.itemIds.length)).toEqual([1, 1]);
    expect(result.status).toBe("awaiting_review");

    const plan = runs[0].libraryPlan as LibraryPlan;
    // Merge deduplicou: a cláusula da Porto é UMA, a de redação mais longa.
    expect(plan.clauses).toHaveLength(1);
    expect(plan.clauses[0].content).toContain("mais completa");
    // A confiança agregada é a MÍNIMA das famílias.
    expect(plan.confidence).toBe(0.8);
    expect(planning()?.families).toBeDefined();
    expect(Object.keys(planning()!.families!)).toEqual([
      "locacao",
      "locacao_comercial",
    ]);
  });

  it("FANOUT: a família que termina primeiro NÃO é chamada de novo na invocação seguinte", async () => {
    seedPlanning();
    items[0].classification = {
      familyKey: "contrato_locacao:locacao:fiador",
      modalidade: "locacao",
    };
    items[1].classification = {
      familyKey: "contrato_locacao:locacao_comercial:fiador",
      modalidade: "locacao_comercial",
    };

    const calls: string[] = [];
    const planner: LibraryPlanner = vi.fn(async (input, options) => {
      const comercial = input.items.some(
        (i) => i.classification?.modalidade === "locacao_comercial"
      );
      calls.push(comercial ? "comercial" : "residencial");
      const ladder = options.ladder ?? { stepIndex: 0, attempts: [] };
      // comercial precisa de 2 degraus; residencial aceita de primeira
      const accepted = !comercial || ladder.stepIndex > 0;
      return {
        plan: emptyPlan(accepted ? 0.9 : 0.5),
        accepted,
        escalated: false,
        attempts: [],
        indexBudget: {
          limit: 100,
          indexed: 1,
          dropped: 0,
          truncated: false,
          families: [],
          droppedItemIds: [],
        },
        nextLadder: accepted ? null : { stepIndex: 1, attempts: [] },
      };
    });

    const primeira = await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    expect(primeira.hasMore).toBe(true);
    expect(calls.sort()).toEqual(["comercial", "residencial"]);

    calls.length = 0;
    runs[0].startedAt = null;
    const segunda = await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    // Só a família pendente volta ao modelo — a aceita não paga de novo.
    expect(calls).toEqual(["comercial"]);
    expect(segunda.status).toBe("awaiting_review");
  });

  it("a invocação seguinte usa as violações do degrau anterior", async () => {
    seedPlanning();
    const planner = ladderPlanner([
      { plan: emptyPlan(0.5), accepted: false, violations: [VIOLACAO] },
      { plan: emptyPlan(), accepted: true },
    ]);

    await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    await advanceRun({ runId: "run-1", orgId: "org-1", planner });

    const calls = (planner as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const ladder = (calls[1][1] as { ladder?: PlanLadderState }).ladder;
    expect(ladder?.stepIndex).toBe(1);
    expect(ladder?.attempts[0].violations[0].detail).toBe(VIOLACAO.detail);
  });

  it("aceito no degrau 2: o plano é gravado e o run vai a awaiting_review", async () => {
    seedPlanning();
    const aceito: LibraryPlan = {
      ...emptyPlan(),
      templates: [
        {
          sourceItemId: "item-0",
          name: "Locação residencial — fiador",
          modalidade: "locacao",
          matchCriteria: { garantia: "fiador" },
          rationale: "Minuta completa.",
        },
      ],
    };
    const planner = ladderPlanner([
      { plan: emptyPlan(0.5), accepted: false, violations: [VIOLACAO] },
      { plan: aceito, accepted: true },
    ]);

    await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    const segunda = await advanceRun({ runId: "run-1", orgId: "org-1", planner });

    expect(planner).toHaveBeenCalledTimes(2);
    expect(segunda.status).toBe("awaiting_review");
    expect((runs[0].libraryPlan as LibraryPlan).templates).toHaveLength(1);
    expect(planning()?.accepted).toBe(true);
    expect(planning()?.nextStepIndex).toBeNull();
    expect(planning()?.stepsStarted).toBe(2);
    // O histórico dos DOIS degraus continua no relatório do run.
    expect(planning()?.attempts).toHaveLength(2);
    expect(planning()?.attempts[0].violations[0].kind).toBe(
      "missing_garantia_criteria"
    );
  });

  it("escada esgotada vai a awaiting_review com as issues, não a failed", async () => {
    seedPlanning();
    const recusado: LibraryPlan = {
      ...emptyPlan(0.4),
      issues: [
        {
          itemId: "item-0",
          kind: "plan_invalid",
          detail: "O modelo de locação não diz qual garantia ele atende.",
        },
      ],
    };
    const planner = ladderPlanner([
      { plan: recusado, accepted: false, violations: [VIOLACAO] },
    ]);

    let result = await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    for (let i = 0; i < PLAN_LADDER_STEPS && result.hasMore; i++) {
      result = await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    }

    expect(planner).toHaveBeenCalledTimes(PLAN_LADDER_STEPS);
    // Quem decide o que fazer com um plano recusado é o operador.
    expect(result.status).toBe("awaiting_review");
    expect(runs[0].error).toBeNull();
    expect((runs[0].libraryPlan as LibraryPlan).issues.map((i) => i.kind)).toContain(
      "plan_invalid"
    );
    expect(planning()?.attempts).toHaveLength(PLAN_LADDER_STEPS);
  });

  it("uma invocação dá UM degrau e para — nem com orçamento de sobra ela emenda", async () => {
    seedPlanning();
    const planner = ladderPlanner([
      { plan: emptyPlan(0.5), accepted: false, violations: [VIOLACAO] },
    ]);

    await advanceRun({
      runId: "run-1",
      orgId: "org-1",
      planner,
      budgetMs: SLICE_BUDGET_MS,
    });

    expect(planner).toHaveBeenCalledTimes(1);
  });
});

describe("advanceRun — teto de degraus de planejamento", () => {
  /**
   * O que o sweeper faz com um run cuja função morreu no meio da chamada: o
   * claim vence, o run volta a ser reivindicável e a chamada REPETE. É este laço
   * — pago a cada volta — que o teto fecha.
   */
  function resumeAfterDeath(): void {
    runs[0].status = "planning";
    runs[0].startedAt = null;
    runs[0].error = null;
  }

  it("o degrau é gravado ANTES da chamada — o que morre no timeout também conta", async () => {
    seedPlanning();
    const planner: LibraryPlanner = vi.fn(async () => {
      // No instante em que o planner é chamado o contador JÁ está no banco.
      // Contado depois, o caso que interessa (o degrau que não volta) nunca
      // seria contado.
      expect(planning()?.stepsStarted).toBe(1);
      return {
        plan: emptyPlan(),
        accepted: true,
        escalated: false,
        attempts: [],
        indexBudget: fullIndexBudget(),
        nextLadder: null,
      };
    });

    await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    expect(planner).toHaveBeenCalledTimes(1);
    expect(planning()?.maxSteps).toBe(MAX_PLAN_STEPS);
  });

  it("família que esgota os degraus é finalizada SEM nova chamada paga — e revisável", async () => {
    // Antes do fanout, esgotar derrubava o run inteiro (PlanStepLimitError).
    // Agora a família é finalizada com plano vazio + issue: as demais famílias
    // e a revisão humana continuam — e a garantia central é a mesma: nenhuma
    // chamada paga a mais.
    seedPlanning();
    const planner: LibraryPlanner = vi.fn(async () => {
      throw new Error("a função morreu antes da resposta");
    });

    for (let i = 0; i < MAX_PLAN_STEPS; i++) {
      resumeAfterDeath();
      await advanceRun({ runId: "run-1", orgId: "org-1", planner });
    }
    expect(planner).toHaveBeenCalledTimes(MAX_PLAN_STEPS);
    expect(planning()?.stepsStarted).toBe(MAX_PLAN_STEPS);

    resumeAfterDeath();
    const result = await advanceRun({ runId: "run-1", orgId: "org-1", planner });

    // A volta seguinte não gasta chamada nenhuma.
    expect(planner).toHaveBeenCalledTimes(MAX_PLAN_STEPS);
    expect(result.status).toBe("awaiting_review");
    const plan = runs[0].libraryPlan as {
      issues: Array<{ kind: string; detail: string }>;
      templates: unknown[];
    };
    expect(plan.templates).toEqual([]);
    expect(plan.issues.some((i) => i.kind === "plan_invalid")).toBe(true);
    expect(plan.issues[0].detail).toContain("degraus");
    // Parada controlada: o claim é liberado e nada do lote se perde.
    expect(runs[0].startedAt).toBeNull();
    expect(items.every((i) => i.status === "classified")).toBe(true);
  });

  it("o degrau que morre come um degrau da escada, e ela termina mais cedo", async () => {
    seedPlanning();
    const morto: LibraryPlanner = vi.fn(async () => {
      throw new Error("a função morreu antes da resposta");
    });
    // O primeiro degrau não volta: pago, invisível ao medidor, e contado.
    await advanceRun({ runId: "run-1", orgId: "org-1", planner: morto });
    expect(planning()?.stepsStarted).toBe(1);

    const vivo = ladderPlanner([
      { plan: emptyPlan(0.4), accepted: false, violations: [VIOLACAO] },
    ]);
    let result: AdvanceRunResult;
    do {
      resumeAfterDeath();
      result = await advanceRun({ runId: "run-1", orgId: "org-1", planner: vivo });
    } while (result.hasMore);

    // Um degrau a menos que a escada inteira — e ainda assim revisável.
    expect(vivo).toHaveBeenCalledTimes(MAX_PLAN_STEPS - 1);
    expect(result.status).toBe("awaiting_review");
    expect(runs[0].libraryPlan).not.toBeNull();
  });

  it("o contador é do RUN e sobrevive à invocação — vive no report", async () => {
    seedPlanning();
    runs[0].report = {
      planning: {
        startedAt: new Date().toISOString(),
        stepsStarted: MAX_PLAN_STEPS,
        maxSteps: MAX_PLAN_STEPS,
        nextStepIndex: 0,
        attempts: [],
        classifier: "llm",
        durationMs: 0,
        plannedAt: null,
        accepted: false,
        escalated: false,
        confidence: 0,
        indexBudget: null,
        families: {
          lote: {
            stepsStarted: MAX_PLAN_STEPS,
            nextStepIndex: 0,
            attempts: [],
            accepted: false,
            escalated: false,
            confidence: 0,
            durationMs: 0,
            indexBudget: null,
            itemCount: 2,
            plan: null,
          },
        },
      } satisfies PlanningReport,
    };
    const planner = plannerReturning({ plan: emptyPlan(), accepted: true });

    const result = await advanceRun({ runId: "run-1", orgId: "org-1", planner });

    // O contador veio do report: a família já gastou tudo, nenhuma chamada.
    expect(planner).not.toHaveBeenCalled();
    expect(result.status).toBe("awaiting_review");
    const plan = runs[0].libraryPlan as { issues: Array<{ kind: string }> };
    expect(plan.issues.some((i) => i.kind === "plan_invalid")).toBe(true);
  });
});

describe("advanceRun — instrumentação de duração", () => {
  function timings(): Record<string, StageTiming> {
    return (runs[0].report as { timings?: Record<string, StageTiming> }).timings ?? {};
  }

  it("grava a duração da chamada do planner no report", async () => {
    seed(2);
    const planner = plannerReturning({
      plan: emptyPlan(),
      accepted: true,
      delayMs: 15,
    });

    await drain({ planner });

    const report = runs[0].report as { planning?: PlanningReport };
    expect(report.planning?.durationMs).toBeGreaterThan(0);
    expect(timings().plan.calls).toBe(1);
    expect(timings().plan.totalMs).toBe(report.planning?.durationMs);
    expect(timings().plan.maxMs).toBe(report.planning?.durationMs);
  });

  it("conta uma chamada de classificação por item", async () => {
    seed(3);
    await drain();
    expect(timings().classify.calls).toBe(3);
    expect(timings().classify.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("o cronômetro da classificação ACUMULA — uma fatia não apaga a anterior", async () => {
    seed(2, "classifying");
    for (const item of items) {
      item.status = "extracted";
      item.text = CONTRATO;
    }
    runs[0].report = {
      timings: { classify: { calls: 5, totalMs: 500, maxMs: 200, lastMs: 100 } },
    };

    await advanceRun({ runId: "run-1", orgId: "org-1", maxSteps: 1 });

    expect(timings().classify.calls).toBe(7);
    expect(timings().classify.totalMs).toBeGreaterThanOrEqual(500);
    expect(timings().classify.maxMs).toBeGreaterThanOrEqual(200);
  });
});

describe("orçamento da fatia × maxDuration da rota", () => {
  const ROUTES = join(__dirname, "..", "..", "..", "app", "api", "templates", "ingest", "runs", "[id]");

  /** O `maxDuration` declarado na rota, lido do arquivo. */
  function maxDurationOf(route: string): number {
    const source = readFileSync(join(ROUTES, route, "route.ts"), "utf8");
    const match = source.match(/export const maxDuration = (\d+)/);
    expect(match, `${route} declara maxDuration`).toBeTruthy();
    return Number(match![1]);
  }

  it("as duas rotas do pipeline têm o mesmo teto", () => {
    expect(maxDurationOf("advance")).toBe(300);
    expect(maxDurationOf("execute")).toBe(maxDurationOf("advance"));
  });

  it("a fatia acaba com folga para gravar o estado e re-encadear", () => {
    // A folga é o que salva o claim: uma fatia cortada pelo timeout da Vercel
    // deixaria `startedAt` carimbado até a janela de stale vencer.
    const ceiling = maxDurationOf("advance") * 1_000;
    expect(SLICE_BUDGET_MS).toBeLessThanOrEqual(ceiling - 30_000);
  });

  it("o piso do planner cabe na fatia — senão `planning` nunca começaria", () => {
    expect(PLAN_MIN_BUDGET_MS).toBeLessThan(SLICE_BUDGET_MS);
    expect(PLAN_MIN_BUDGET_MS).toBeGreaterThan(0);
  });

  it("o piso reserva folga sobre o degrau medido em staging (147s)", () => {
    // O piso protege UM degrau, não a escada inteira — é por isso que ele cabe.
    // A folga existe porque a duração varia com o tamanho do lote.
    const MEDIDO_MS = 147_000;
    expect(PLAN_MIN_BUDGET_MS).toBeGreaterThan(MEDIDO_MS * 1.25);
  });

  it("o teto de degraus não trunca a escada em silêncio", () => {
    // Teto menor que a escada faria o run parar antes do último modelo sem que
    // nada no relatório dissesse que faltou degrau.
    expect(MAX_PLAN_STEPS).toBeGreaterThanOrEqual(PLAN_LADDER_STEPS);
  });

  it("a janela de stale é maior que o maxDuration — o sweeper não rouba worker vivo", () => {
    // Com stale ≤ maxDuration, o sweeper reivindicaria um run cuja chamada do
    // planner ainda está em andamento e pagaria a mesma chamada duas vezes.
    expect(RUN_STALE_MS).toBeGreaterThan(maxDurationOf("advance") * 1_000);
  });
});
