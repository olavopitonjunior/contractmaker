import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { advanceReviewRun } from "../executor";
import { buildGenerationPlan } from "../plan";

vi.mock("../guard", () => ({
  isContractReviewEnabled: vi.fn(async () => true),
}));
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: vi.fn(),
}));
// O estágio LLM tem testes próprios (reviewer.test.ts); aqui ele é stubado
// para os testes do executor não dependerem do runner estruturado.
vi.mock("../reviewer", async () => {
  const actual = await vi.importActual<typeof import("../reviewer")>("../reviewer");
  return {
    ...actual,
    runContractReviewLlm: vi.fn(async () => ({
      findings: [],
      documentOk: true,
      violations: [],
      steps: [],
      retried: false,
    })),
  };
});

import { isContractReviewEnabled } from "../guard";
import { getDocPlainText } from "@/lib/google/docs";
import { runContractReviewLlm } from "../reviewer";

const runUpdateMany = prisma.contractReviewRun.updateMany as ReturnType<typeof vi.fn>;
const runFindUnique = prisma.contractReviewRun.findUnique as ReturnType<typeof vi.fn>;
const runFindUniqueOrThrow = prisma.contractReviewRun.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const runUpdate = prisma.contractReviewRun.update as ReturnType<typeof vi.fn>;
const contractFindUnique = prisma.contract.findUnique as ReturnType<typeof vi.fn>;
const commentUpsert = prisma.contractComment.upsert as ReturnType<typeof vi.fn>;

const RUN = { id: "run1", orgId: "org1", contractId: "c1", attempt: 1 };

function mockContract(overrides: Record<string, unknown> = {}) {
  contractFindUnique.mockResolvedValue({
    id: "c1",
    status: "rascunho",
    htmlContent: "<p>Contrato íntegro sem chave.</p>",
    googleDocId: null,
    generationPlanJson: null,
    deal: { kind: "locacao" },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runUpdateMany.mockResolvedValue({ count: 1 });
  runFindUniqueOrThrow.mockResolvedValue(RUN);
  runUpdate.mockResolvedValue({});
  commentUpsert.mockResolvedValue({});
  (isContractReviewEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (runContractReviewLlm as ReturnType<typeof vi.fn>).mockResolvedValue({
    findings: [],
    documentOk: true,
    violations: [],
    steps: [],
    retried: false,
  });
});

describe("advanceReviewRun", () => {
  it("claim perdido → claimed:false com o status corrente", async () => {
    runUpdateMany.mockResolvedValue({ count: 0 });
    runFindUnique.mockResolvedValue({ status: "done" });
    const result = await advanceReviewRun("run1");
    expect(result).toEqual({ runId: "run1", claimed: false, status: "done" });
    expect(contractFindUnique).not.toHaveBeenCalled();
  });

  it("contrato aprovado → skipped (imutável, como os analisadores da geração)", async () => {
    mockContract({ status: "aprovado" });
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("contract-approved");
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "skipped" }) })
    );
  });

  it("flag desligada → skipped", async () => {
    mockContract();
    (isContractReviewEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("feature-disabled");
  });

  it("caminho feliz: checks rodam sobre o htmlContent e o run fecha done", async () => {
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "SF", engine: "handlebars" },
      manualTemplate: false,
      garantiaMatched: false,
      templateNotice: "Sem modelo próprio de Caução.",
      dataJson: { garantia: { tipo: "caucao" } },
    });
    mockContract({
      htmlContent: "<p>Aluguel de R$ {{valor}} mensais.</p>",
      generationPlanJson: JSON.parse(JSON.stringify(plan)),
    });
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("done");

    // Render linter pegou o {{valor}} (namespace render:) e o plano acusou o
    // D16 (namespace review:) — ambos como comentário IA.
    const dedupeKeys = commentUpsert.mock.calls.map(
      (c) => c[0].create.dedupeKey as string
    );
    expect(commentUpsert.mock.calls.length).toBeGreaterThanOrEqual(2);
    const authors = commentUpsert.mock.calls.map((c) => c[0].create.authorName);
    expect(authors).toContain("Análise de Qualidade");
    expect(authors).toContain("Revisão Pós-Geração");
    // Nenhum error — a revisão só avisa.
    for (const call of commentUpsert.mock.calls) {
      expect(["info", "warning", "error"]).toContain(call[0].create.severity);
      if (call[0].create.authorName === "Revisão Pós-Geração") {
        expect(call[0].create.severity).not.toBe("error");
      }
    }
    expect(new Set(dedupeKeys).size).toBe(dedupeKeys.length);
  });

  it("Drive indisponível com tentativas sobrando → devolve a queued", async () => {
    mockContract({ googleDocId: "doc1" });
    (getDocPlainText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("drive down"));
    runFindUniqueOrThrow.mockResolvedValue({ ...RUN, attempt: 1 });
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("queued");
    expect(result.reason).toBe("drive-retry");
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: "run1" },
      data: { status: "queued", startedAt: null },
    });
  });

  it("Drive indisponível na 3ª tentativa → failed", async () => {
    mockContract({ googleDocId: "doc1" });
    (getDocPlainText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("drive down"));
    runFindUniqueOrThrow.mockResolvedValue({ ...RUN, attempt: 3 });
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("drive-unavailable");
  });

  it("findings do LLM viram ContractComment e o custo vai pro run", async () => {
    mockContract({ htmlContent: "<p>O aluguel mensal é de R$ 2.500,00.</p>" });
    (runContractReviewLlm as ReturnType<typeof vi.fn>).mockResolvedValue({
      findings: [
        {
          category: "dados_form",
          severity: "warning",
          title: "Aluguel divergente",
          finding: "Form R$ 2.300 × texto R$ 2.500.",
          selectedText: "O aluguel mensal é de R$ 2.500,00",
          suggestedFix: "Corrija no formulário do negócio.",
        },
      ],
      documentOk: false,
      violations: [],
      steps: [
        {
          model: "claude-sonnet-5",
          usage: { promptTokens: 10_000, completionTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 2_000 },
          latencyMs: 900,
        },
      ],
      retried: false,
    });

    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("done");

    const llmComment = commentUpsert.mock.calls.find(
      (c) => c[0].create.authorName === "Revisão Pós-Geração"
    );
    expect(llmComment).toBeDefined();
    expect(llmComment![0].create.severity).toBe("warning");
    expect(llmComment![0].create.dedupeKey).toMatch(/^ai-/);
    expect(llmComment![0].create.text).toContain("Aluguel divergente");

    // Custo do degrau acumulado no run (sonnet-5: 10k×$2 + 1k×$10 + 2k×$2.5 por MTok).
    const costUpdate = runUpdate.mock.calls.find((c) => c[0].data?.aiCostUsd !== undefined);
    expect(costUpdate).toBeDefined();
    expect(costUpdate![0].data.aiCostUsd).toBeCloseTo(0.035, 3);
  });

  it("erro de API no LLM → run devolvido a queued (retry)", async () => {
    mockContract();
    (runContractReviewLlm as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("api down"));
    runFindUniqueOrThrow.mockResolvedValue({ ...RUN, attempt: 1 });
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("queued");
    expect(result.reason).toBe("llm-retry");
  });

  it("contrato sem plano (legado/importado) → done sem findings de plano", async () => {
    mockContract({ generationPlanJson: null, htmlContent: "<p>Texto limpo.</p>" });
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("done");
    const authors = commentUpsert.mock.calls.map((c) => c[0].create.authorName);
    expect(authors).not.toContain("Revisão Pós-Geração");
  });
});
