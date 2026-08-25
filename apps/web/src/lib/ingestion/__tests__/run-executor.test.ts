import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import type { ItemStatus, RunStatus } from "@/lib/ingestion/run-state";

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

import { advanceRun } from "@/lib/ingestion/run-executor";

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

beforeEach(() => {
  vi.clearAllMocks();
  installHarness();
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

  it("percorre o pipeline até parar em planning, sem inventar libraryPlan", async () => {
    seed(3);
    let result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    for (let i = 0; i < 5 && result.hasMore; i++) {
      result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    }

    expect(result.status).toBe("planning");
    expect(result.hasMore).toBe(false);
    expect(runs[0].status).toBe("planning");
    // O agrupamento determinístico ficou no report; nenhum plano foi inventado.
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
    runs[0].startedAt = new Date(Date.now() - 10 * 60 * 1000);

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

  it("run parado em planning não é reivindicado — espera o planner da Fase A2", async () => {
    seed(1, "planning");
    const result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    expect(result.claimed).toBe(false);
    expect(runs[0].status).toBe("planning");
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
    let result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    while (result.hasMore) {
      result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    }
    const snapshot = JSON.parse(JSON.stringify(items));
    const extractCalls = extractDocxMock.mock.calls.length;

    // O run está em `planning`: nem a rota nem o cron o reivindicam de novo.
    const again = await advanceRun({ runId: "run-1", orgId: "org-1" });
    expect(again.claimed).toBe(false);
    expect(extractDocxMock.mock.calls.length).toBe(extractCalls);
    expect(JSON.parse(JSON.stringify(items))).toEqual(snapshot);
  });

  it("itens descartados no intake ficam fora de toda fatia", async () => {
    seed(3);
    items[0].status = "discarded";

    let result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    while (result.hasMore) {
      result = await advanceRun({ runId: "run-1", orgId: "org-1" });
    }

    expect(items[0].status).toBe("discarded");
    expect(items[0].text).toBeNull();
    expect(extractDocxMock).toHaveBeenCalledTimes(2);
  });
});
