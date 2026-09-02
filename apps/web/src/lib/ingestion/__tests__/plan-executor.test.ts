import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { LIBRARY_PLAN_VERSION, type LibraryPlan } from "@/lib/ingestion/library-plan";
import type { ReviewedLibraryPlan } from "@/lib/ingestion/library-plan";

// ── Dependências pesadas: Drive, Blob, acervo e embeddings ──────────────────
const ingestTemplateMock = vi.fn();
vi.mock("@/lib/templates/ingest-template-from-docx", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/templates/ingest-template-from-docx")
  >("@/lib/templates/ingest-template-from-docx");
  return {
    ...actual,
    ingestTemplateFromDocx: (...args: unknown[]) => ingestTemplateMock(...args),
  };
});

const ingestClausesMock = vi.fn();
vi.mock("@/lib/templates/ingest-clauses", async () => {
  const actual = await vi.importActual<typeof import("@/lib/templates/ingest-clauses")>(
    "@/lib/templates/ingest-clauses"
  );
  return {
    ...actual,
    ingestSlotClauses: (...args: unknown[]) => ingestClausesMock(...args),
  };
});

const embedMock = vi.fn(async () => {});
vi.mock("@/lib/ai/knowledge", () => ({
  embedKnowledgeItem: (...args: unknown[]) => embedMock(...args),
}));

const getOrgModulesMock = vi.fn();
vi.mock("@/lib/modules/read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/modules/read")>(
    "@/lib/modules/read"
  );
  return { ...actual, getOrgModules: (...args: unknown[]) => getOrgModulesMock(...args) };
});

import { DuplicateTemplateError } from "@/lib/templates/ingest-template-from-docx";
import { executePlanSlice } from "@/lib/ingestion/plan-executor";
import { readExecutionReport } from "@/lib/ingestion/execution-report";
import { summarizePii } from "@/lib/ingestion/classifier";
import { detectPii } from "@/lib/ingestion/pii";

// ────────────────────────────────────────────────────────────────────────────
// Harness: banco em memória que HONRA o `where`.
//
// Mesma escolha do teste de `run-executor`: o claim do run e o de cada item são
// decididos pelo `where` do updateMany, então um mock que sempre devolvesse
// `{ count: 1 }` esconderia justamente o que precisa ser testado.
// ────────────────────────────────────────────────────────────────────────────

interface FakeRun {
  id: string;
  orgId: string;
  createdBy: string | null;
  status: string;
  startedAt: Date | null;
  itemsTotal: number;
  itemsDone: number;
  libraryPlan: unknown;
  planReviewed: unknown;
  report: unknown;
  aiCostUsd: unknown;
  error: string | null;
  createdAt: Date;
}

interface FakeItem {
  id: string;
  runId: string;
  filename: string;
  fileKind: string;
  blobUrl: string;
  status: string;
  text: string | null;
  piiReport: unknown;
  createdAt: Date;
}

let runs: FakeRun[] = [];
let items: FakeItem[] = [];
let createdTemplates: Array<Record<string, unknown>> = [];
/** Ordem real das escritas — é o que prova cláusula-antes-de-template. */
let callOrder: string[] = [];

function statusMatches(where: unknown, status: string): boolean {
  if (where === undefined) return true;
  if (typeof where === "string") return where === status;
  const filter = where as { in?: string[] };
  return filter.in ? filter.in.includes(status) : true;
}

function matchRun(run: FakeRun, where: Record<string, unknown>): boolean {
  if (where.id && where.id !== run.id) return false;
  if (where.orgId && where.orgId !== run.orgId) return false;
  if (!statusMatches(where.status, run.status)) return false;
  const or = where.OR as Array<{ startedAt: null | { lt: Date } }> | undefined;
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
  const kbModel = prisma.knowledgeItem as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  const templateModel = prisma.contractTemplate as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  const usageModel = prisma.aIUsage as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  >;

  runModel.updateMany.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const hits = runs.filter((r) => matchRun(r, where));
      for (const run of hits) Object.assign(run, data);
      return { count: hits.length };
    }
  );
  runModel.findFirst.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) =>
      runs.find(
        (r) =>
          (!where.id || where.id === r.id) && (!where.orgId || where.orgId === r.orgId)
      ) ?? null
  );
  itemModel.findMany.mockImplementation(
    async ({ where }: { where: { runId: string } }) =>
      items.filter((i) => i.runId === where.runId)
  );
  itemModel.updateMany.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const hits = items.filter(
        (i) =>
          (!where.id || where.id === i.id) &&
          (!where.runId || where.runId === i.runId) &&
          statusMatches(where.status, i.status)
      );
      for (const item of hits) Object.assign(item, data);
      return { count: hits.length };
    }
  );
  kbModel.updateMany.mockImplementation(async () => ({ count: 1 }));
  templateModel.findMany.mockImplementation(async () => createdTemplates);
  usageModel.aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 0.4231 } });
}

const CLAUSE_TEXT =
  "A garantia locatícia será prestada por seguro fiança contratado junto à " +
  "seguradora indicada pela administradora, com cobertura de aluguéis e encargos.";

/** Texto com CPF válido — é o que o gate de PII tem de barrar. */
const DIRTY_CLAUSE_TEXT =
  "O fiador Sr. Fulano, inscrito no CPF 111.444.777-35, responde solidariamente " +
  "pelas obrigações do presente contrato de locação residencial urbana.";

// ── Nome e endereço: as duas categorias sem detector determinístico ──────────
// Dados FICTÍCIOS. Nenhum detector por regex os acha; quem os aponta é o
// classificador LLM, e é por isso que os offsets precisam ser persistidos.
const FIADOR_NAME = "JOANA EXEMPLO DA SILVA";
const FIADOR_ADDRESS = "Rua Inventada, nº 404, Bairro Fictício";

/** Cláusula de garantia que nomeia o fiador — o que não pode virar embedding. */
const NAMED_CLAUSE_TEXT =
  `Assina na condição de fiador e devedor solidário ${FIADOR_NAME}, ` +
  "residente e domiciliada na cidade de Piracicaba/SP, por todas as obrigações " +
  "assumidas pelo locatário neste contrato.";

/** O texto do item: o documento inteiro, do qual a cláusula é um recorte. */
const ITEM_TEXT = [
  "CONTRATO DE LOCAÇÃO RESIDENCIAL",
  "",
  NAMED_CLAUSE_TEXT,
  "",
  `Endereço do fiador: ${FIADOR_ADDRESS}.`,
].join("\n");

/** O `piiReport` que o classificador LLM grava para esse item. */
function piiReportFor(text: string): unknown {
  const findings = detectPii(text, {
    externalEntities: [
      { kind: "person_name", excerpt: FIADOR_NAME },
      { kind: "address", excerpt: FIADOR_ADDRESS },
    ],
  });
  return summarizePii(findings, text);
}

function clauseWithContent(content: string): LibraryPlan["clauses"][number] {
  return {
    slot: "garantia",
    value: "fiador",
    provider: null,
    title: "Fiador",
    content,
    sourceItemId: "item-0",
    tags: ["slot:garantia", "garantia:fiador"],
    rationale: "Bloco divergente.",
  };
}

function plan(overrides: Partial<LibraryPlan> = {}): LibraryPlan {
  return {
    version: LIBRARY_PLAN_VERSION,
    templates: [
      {
        sourceItemId: "item-0",
        name: "Locação residencial — seguro fiança",
        modalidade: "locacao",
        matchCriteria: { garantia: "seguro_fianca" },
        slotBlocks: { garantia: ["Parágrafo da garantia."] },
        rationale: "É o modelo completo da família.",
      },
    ],
    clauses: [
      {
        slot: "garantia",
        value: "seguro_fianca",
        provider: "Porto Seguro",
        title: "Seguro fiança — Porto Seguro",
        content: CLAUSE_TEXT,
        sourceItemId: "item-0",
        tags: ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"],
        rationale: "É a redação que muda entre as versões.",
      },
    ],
    discards: [],
    issues: [],
    confidence: 0.9,
    ...overrides,
  };
}

function reviewed(plan: LibraryPlan, overrides: Partial<ReviewedLibraryPlan> = {}) {
  return {
    reviewedBy: "user-1",
    reviewedAt: "2026-08-25T12:00:00.000Z",
    templates: plan.templates.map((t) => ({
      sourceItemId: t.sourceItemId,
      approved: true,
    })),
    clauses: plan.clauses.map((c) => ({
      sourceItemId: c.sourceItemId,
      tags: c.tags,
      approved: true,
    })),
    discards: plan.discards.map((d) => ({ itemId: d.itemId, approved: true })),
    ...overrides,
  } satisfies ReviewedLibraryPlan;
}

function seed(args: {
  plan: LibraryPlan;
  reviewed: ReviewedLibraryPlan;
  itemCount?: number;
  status?: string;
  /** Texto extraído e relatório de PII do `item-0` — o gate lê os dois. */
  itemText?: string;
  itemPiiReport?: unknown;
  itemClassification?: unknown;
}): void {
  runs = [
    {
      id: "run-1",
      orgId: "org-1",
      createdBy: "user-1",
      status: args.status ?? "executing",
      startedAt: null,
      itemsTotal: args.itemCount ?? 1,
      itemsDone: 0,
      libraryPlan: args.plan,
      planReviewed: args.reviewed,
      report: { grouping: { families: [] } },
      aiCostUsd: null,
      error: null,
      createdAt: new Date(2026, 7, 25, 10, 0, 0),
    },
  ];
  items = Array.from({ length: args.itemCount ?? 1 }, (_, i) => ({
    id: `item-${i}`,
    runId: "run-1",
    filename: `contrato-${i}.docx`,
    fileKind: "docx",
    blobUrl: `https://s.public.blob.vercel-storage.com/ingestion/org-1/contrato-${i}.docx`,
    status: "classified",
    text: i === 0 ? (args.itemText ?? null) : null,
    piiReport: i === 0 ? (args.itemPiiReport ?? null) : null,
    classification: i === 0 ? (args.itemClassification ?? null) : null,
    createdAt: new Date(2026, 7, 25, 10, 0, i),
  }));
}

const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(60).fill(0x41)]);

/** Roda fatia após fatia até o run parar de pedir mais (teto de segurança). */
async function runToCompletion(maxSlices = 10) {
  let result = await executePlanSlice({ runId: "run-1", orgId: "org-1" });
  for (let i = 0; i < maxSlices && result.hasMore; i++) {
    result = await executePlanSlice({ runId: "run-1", orgId: "org-1" });
  }
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  runs = [];
  items = [];
  createdTemplates = [];
  callOrder = [];
  installHarness();

  getOrgModulesMock.mockResolvedValue({
    enabled: { vendas: false, locacao: true },
    features: {},
  });

  let clauseSeq = 0;
  ingestClausesMock.mockImplementation(
    async (input: {
      slot: string;
      variants: Array<{ value: string; provider?: string; title?: string }>;
    }) => {
      callOrder.push("clause");
      clauseSeq += 1;
      return {
        slot: input.slot,
        items: input.variants.map((v) => ({
          id: `kb-${clauseSeq}`,
          title: v.title ?? "Cláusula",
          value: v.value,
          provider: v.provider ?? null,
          tags: ["slot:garantia", `garantia:${v.value}`],
          archivedIds: [],
        })),
        embedTargets: [{ id: `kb-${clauseSeq}`, text: "…" }],
      };
    }
  );

  let templateSeq = 0;
  ingestTemplateMock.mockImplementation(async (input: { name: string }) => {
    callOrder.push("template");
    templateSeq += 1;
    const row = {
      id: `tpl-${templateSeq}`,
      name: input.name,
      modalidade: "locacao",
      status: "draft",
      engine: "google_docs",
      sourceHash: "a".repeat(64),
      matchCriteria: { garantia: "seguro_fianca" },
    };
    createdTemplates.push(row);
    return {
      templateId: row.id,
      name: input.name,
      docId: `doc-${templateSeq}`,
      webViewLink: "https://docs.google.com/doc",
      embedLink: "https://docs.google.com/embed",
      report: null,
      slots: [{ slot: "garantia", applied: true, token: "slot_garantia", issues: [] }],
    };
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

describe("executePlanSlice — ordem cláusula → template", () => {
  it("grava a cláusula ANTES de criar o modelo que abre o slot", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    await runToCompletion();

    expect(callOrder).toEqual(["clause", "template"]);
  });

  it("a primeira fatia é só das cláusulas — o template vem na seguinte", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    const first = await executePlanSlice({ runId: "run-1", orgId: "org-1" });

    expect(first.clausesCreated).toBe(1);
    expect(first.templatesCreated).toBe(0);
    expect(first.hasMore).toBe(true);
    expect(ingestTemplateMock).not.toHaveBeenCalled();
  });

  it("a cláusula nasce pendente — nada é ativado automaticamente", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    await runToCompletion();

    const kb = prisma.knowledgeItem.updateMany as unknown as ReturnType<typeof vi.fn>;
    expect(kb).toHaveBeenCalledWith({
      where: { id: { in: ["kb-1"] }, orgId: "org-1" },
      data: { status: "pending" },
    });
  });
});

describe("executePlanSlice — gate de PII", () => {
  it("cláusula com CPF não é gravada e vira descarte pii_unrecoverable", async () => {
    const p = plan({
      clauses: [
        {
          slot: "garantia",
          value: "fiador",
          provider: null,
          title: "Fiador",
          content: DIRTY_CLAUSE_TEXT,
          sourceItemId: "item-0",
          tags: ["slot:garantia", "garantia:fiador"],
          rationale: "Bloco divergente.",
        },
      ],
    });
    seed({ plan: p, reviewed: reviewed(p) });

    await runToCompletion();

    expect(ingestClausesMock).not.toHaveBeenCalled();
    const report = readExecutionReport(runs[0].report)!;
    expect(report.clauses[0].status).toBe("pii_blocked");
    expect(report.clauses[0].piiKinds).toContain("cpf");
    expect(report.counts.piiBlocked).toBe(1);
    expect(report.discards.some((d) => d.reason === "pii_unrecoverable")).toBe(true);
    expect(report.issues.some((i) => i.kind === "pii_leftover")).toBe(true);
  });

  it("cláusula com NOME de fiador é barrada — os offsets do item alcançam o trecho", async () => {
    // A lacuna que este gate fecha: nome não tem detector por regex. Quem o
    // achou foi o classificador, que gravou os OFFSETS; o texto do item nunca
    // saiu de lá, então o trecho volta a ser localizável.
    const p = plan({ clauses: [clauseWithContent(NAMED_CLAUSE_TEXT)] });
    seed({
      plan: p,
      reviewed: reviewed(p),
      itemText: ITEM_TEXT,
      itemPiiReport: piiReportFor(ITEM_TEXT),
    });

    await runToCompletion();

    expect(ingestClausesMock).not.toHaveBeenCalled();
    const report = readExecutionReport(runs[0].report)!;
    expect(report.clauses[0].status).toBe("pii_blocked");
    expect(report.clauses[0].piiKinds).toContain("person_name");
    expect(report.discards.some((d) => d.reason === "pii_unrecoverable")).toBe(true);
    expect(report.issues.some((i) => i.kind === "pii_leftover")).toBe(true);
    // O nome não chega ao acervo por nenhum caminho.
    expect(JSON.stringify(runs[0].report)).not.toContain(FIADOR_NAME);
  });

  it("a mesma cláusula já sanitizada passa — o placeholder não reacusa", async () => {
    const p = plan({
      clauses: [clauseWithContent(NAMED_CLAUSE_TEXT.replace(FIADOR_NAME, "[NOME]"))],
    });
    seed({
      plan: p,
      reviewed: reviewed(p),
      itemText: ITEM_TEXT,
      itemPiiReport: piiReportFor(ITEM_TEXT),
    });

    await runToCompletion();

    const report = readExecutionReport(runs[0].report)!;
    expect(report.clauses[0].status).toBe("created");
    expect(ingestClausesMock).toHaveBeenCalledTimes(1);
  });

  it("offsets que não batem com o texto: falha FECHADA, mesmo com cláusula limpa", async () => {
    // Item reextraído depois da classificação: os offsets apontam para outro
    // lugar. Sem confirmar que o trecho foi tratado, não se grava.
    const p = plan({ clauses: [clauseWithContent(CLAUSE_TEXT)] });
    seed({
      plan: p,
      reviewed: reviewed(p),
      itemText: `Cabeçalho novo da reextração.\n${ITEM_TEXT}`,
      itemPiiReport: piiReportFor(ITEM_TEXT),
    });

    await runToCompletion();

    expect(ingestClausesMock).not.toHaveBeenCalled();
    const report = readExecutionReport(runs[0].report)!;
    expect(report.clauses[0].status).toBe("pii_blocked");
    expect(report.clauses[0].piiKinds).toEqual(["person_name", "address"]);
    expect(report.clauses[0].detail).toContain("Não foi possível confirmar");
    expect(report.discards.some((d) => d.reason === "pii_unrecoverable")).toBe(true);
    expect(report.issues.some((i) => i.kind === "pii_leftover")).toBe(true);
  });

  it("piiReport antigo (só contagem, sem offsets) também falha fechado", async () => {
    // Compat de LEITURA não é compat de política: um relatório que afirma haver
    // nome no arquivo e não diz onde é exatamente o caso que não dá para tratar.
    const p = plan({ clauses: [clauseWithContent(CLAUSE_TEXT)] });
    seed({
      plan: p,
      reviewed: reviewed(p),
      itemText: ITEM_TEXT,
      itemPiiReport: { total: 1, byKind: { person_name: 1 }, maxConfidence: 0.9 },
    });

    await runToCompletion();

    expect(ingestClausesMock).not.toHaveBeenCalled();
    expect(readExecutionReport(runs[0].report)!.clauses[0].status).toBe("pii_blocked");
  });

  it("item sem nome nem endereço: relatório antigo continua passando", async () => {
    const p = plan();
    seed({
      plan: p,
      reviewed: reviewed(p),
      itemText: ITEM_TEXT,
      itemPiiReport: { total: 2, byKind: { cpf: 2 }, maxConfidence: 0.99 },
    });

    await runToCompletion();

    expect(readExecutionReport(runs[0].report)!.clauses[0].status).toBe("created");
  });

  it("o modelo do mesmo arquivo continua sendo criado — o gate é da cláusula", async () => {
    const p = plan({
      clauses: [
        {
          slot: "garantia",
          value: "fiador",
          provider: null,
          title: "Fiador",
          content: DIRTY_CLAUSE_TEXT,
          sourceItemId: "item-0",
          tags: ["slot:garantia", "garantia:fiador"],
          rationale: "Bloco divergente.",
        },
      ],
    });
    seed({ plan: p, reviewed: reviewed(p) });

    await runToCompletion();

    expect(ingestTemplateMock).toHaveBeenCalledTimes(1);
    expect(runs[0].status).toBe("done");
  });
});

describe("executePlanSlice — falha de um item não derruba o run", () => {
  it("template que falha vira issue e o próximo é aplicado", async () => {
    const p = plan({
      templates: [
        {
          sourceItemId: "item-0",
          name: "Modelo A",
          modalidade: "locacao",
          matchCriteria: {},
          rationale: "…",
        },
        {
          sourceItemId: "item-1",
          name: "Modelo B",
          modalidade: "locacao",
          matchCriteria: {},
          rationale: "…",
        },
      ],
      clauses: [],
    });
    seed({ plan: p, reviewed: reviewed(p), itemCount: 2 });
    ingestTemplateMock.mockImplementationOnce(async () => {
      throw new Error("Drive fora do ar");
    });

    const result = await runToCompletion();

    expect(result.status).toBe("done");
    expect(runs[0].status).toBe("done");
    const report = readExecutionReport(runs[0].report)!;
    expect(report.templates.map((t) => t.status)).toEqual(["failed", "created"]);
    expect(report.templates[0].detail).toContain("Drive fora do ar");
    expect(report.counts.failures).toBe(1);
    expect(report.counts.templatesCreated).toBe(1);
  });

  it("cláusula que falha na gravação não impede o modelo", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });
    ingestClausesMock.mockRejectedValueOnce(new Error("banco fora"));

    await runToCompletion();

    const report = readExecutionReport(runs[0].report)!;
    expect(report.clauses[0].status).toBe("failed");
    expect(report.counts.templatesCreated).toBe(1);
    expect(runs[0].status).toBe("done");
  });
});

describe("executePlanSlice — idempotência", () => {
  it("DUPLICATE_TEMPLATE é 'já feito', não falha", async () => {
    const p = plan({ clauses: [] });
    seed({ plan: p, reviewed: reviewed(p) });
    ingestTemplateMock.mockImplementationOnce(async () => {
      throw new DuplicateTemplateError({
        id: "tpl-antigo",
        name: "Locação residencial",
        status: "draft",
        modalidade: "locacao",
      } as never);
    });

    await runToCompletion();

    const report = readExecutionReport(runs[0].report)!;
    expect(report.templates[0].status).toBe("duplicate");
    expect(report.templates[0].templateId).toBe("tpl-antigo");
    expect(report.counts.failures).toBe(0);
    expect(runs[0].status).toBe("done");
  });

  it("reexecutar um run concluído não escreve nada — o claim recusa", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });
    await runToCompletion();
    const callsBefore = callOrder.length;

    const again = await executePlanSlice({ runId: "run-1", orgId: "org-1" });

    expect(again.claimed).toBe(false);
    expect(callOrder.length).toBe(callsBefore);
  });

  it("a fase de cláusulas não roda duas vezes", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    await executePlanSlice({ runId: "run-1", orgId: "org-1" });
    await executePlanSlice({ runId: "run-1", orgId: "org-1" });
    await executePlanSlice({ runId: "run-1", orgId: "org-1" });

    expect(ingestClausesMock).toHaveBeenCalledTimes(1);
  });

  it("duas invocações simultâneas: só uma processa", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    const [a, b] = await Promise.all([
      executePlanSlice({ runId: "run-1", orgId: "org-1" }),
      executePlanSlice({ runId: "run-1", orgId: "org-1" }),
    ]);

    expect([a, b].filter((r) => r.claimed)).toHaveLength(1);
    expect(ingestClausesMock).toHaveBeenCalledTimes(1);
  });
});

describe("executePlanSlice — só o aprovado é aplicado", () => {
  it("item desmarcado não é criado e fica registrado como recusado", async () => {
    const p = plan();
    const review = reviewed(p, {
      templates: [{ sourceItemId: "item-0", approved: false }],
    });
    seed({ plan: p, reviewed: review });

    await runToCompletion();

    expect(ingestTemplateMock).not.toHaveBeenCalled();
    const report = readExecutionReport(runs[0].report)!;
    expect(report.rejected.templates).toEqual([
      { sourceItemId: "item-0", name: "Locação residencial — seguro fiança" },
    ]);
    expect(report.counts.templatesCreated).toBe(0);
  });

  it("plano revisado sem entrada para o item NÃO aplica (fail-closed)", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p, { templates: [], clauses: [] }) });

    await runToCompletion();

    expect(ingestTemplateMock).not.toHaveBeenCalled();
    expect(ingestClausesMock).not.toHaveBeenCalled();
  });

  it("descarte recusado pelo operador aparece no relatório", async () => {
    const p = plan({
      discards: [
        { itemId: "item-0", reason: "duplicate", detail: "Igual a outro arquivo." },
      ],
      templates: [],
      clauses: [],
    });
    seed({
      plan: p,
      reviewed: reviewed(p, { discards: [{ itemId: "item-0", approved: false }] }),
    });

    await runToCompletion();

    const report = readExecutionReport(runs[0].report)!;
    expect(report.rejected.discards).toEqual(["item-0"]);
    expect(report.discards).toHaveLength(0);
  });
});

describe("executePlanSlice — relatório final", () => {
  it("fecha o run com contagens, custo de IA e a cobertura resultante", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    const result = await runToCompletion();

    expect(result.hasMore).toBe(false);
    expect(runs[0].status).toBe("done");
    const report = readExecutionReport(runs[0].report)!;
    expect(report.finishedAt).toBeTruthy();
    expect(report.counts).toMatchObject({ templatesCreated: 1, clausesCreated: 1 });
    expect(report.aiCostUsd).toBeCloseTo(0.4231, 4);
    expect(runs[0].aiCostUsd).toBeCloseTo(0.4231, 4);
    // O modelo criado é RASCUNHO: entra na matriz como "falta ativar".
    const cell = report.coverage!.rows
      .find((r) => r.modalidade === "locacao")!
      .cells.find((c) => c.garantia === "seguro_fianca")!;
    expect(cell.state).toBe("draft");
  });

  it("preserva o `grouping` da fase determinística", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    await runToCompletion();

    expect((runs[0].report as Record<string, unknown>).grouping).toEqual({
      families: [],
    });
  });

  it("registra a sugestão de principal sem aplicá-la", async () => {
    const p = plan();
    p.templates[0].isDefaultSuggested = true;
    seed({ plan: p, reviewed: reviewed(p) });

    await runToCompletion();

    const report = readExecutionReport(runs[0].report)!;
    expect(report.templates[0].isDefaultSuggested).toBe(true);
    // O que foi pro `ingestTemplateFromDocx` não carrega isDefault nenhum.
    expect(ingestTemplateMock.mock.calls[0][0]).not.toHaveProperty("isDefault");
  });

  it("gabarito (A8): só item classificado como instância preenchida pede extração", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p), itemClassification: { isFilledInstance: true } });
    await runToCompletion();
    const arg = ingestTemplateMock.mock.calls[0][0] as { extractGabarito?: { userId?: unknown } | null };
    expect(arg.extractGabarito).not.toBeNull();
    // userId = createdBy do run (quem paga a chamada no AIUsage)
    expect(arg.extractGabarito).toHaveProperty("userId");
  });

  it("gabarito (A8): minuta em branco (sem isFilledInstance) NÃO pede extração", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p), itemClassification: { isFilledInstance: false } });
    await runToCompletion();
    expect(ingestTemplateMock.mock.calls[0][0].extractGabarito).toBeNull();
  });

  it("plano ilegível derruba o run com mensagem, sem escrever nada", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });
    runs[0].libraryPlan = { version: 99, templates: [] };

    const result = await executePlanSlice({ runId: "run-1", orgId: "org-1" });

    expect(result.status).toBe("failed");
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toContain("Plano");
    expect(ingestTemplateMock).not.toHaveBeenCalled();
  });
});

describe("executePlanSlice — multi-tenant", () => {
  it("run de outra imobiliária não é reivindicado", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    const result = await executePlanSlice({ runId: "run-1", orgId: "org-2" });

    expect(result.claimed).toBe(false);
    expect(ingestClausesMock).not.toHaveBeenCalled();
    expect(runs[0].status).toBe("executing");
  });

  it("toda escrita de cláusula leva o orgId do run", async () => {
    const p = plan();
    seed({ plan: p, reviewed: reviewed(p) });

    await runToCompletion();

    expect(ingestClausesMock.mock.calls[0][0]).toMatchObject({ orgId: "org-1" });
    expect(ingestTemplateMock.mock.calls[0][0]).toMatchObject({ orgId: "org-1" });
  });
});
