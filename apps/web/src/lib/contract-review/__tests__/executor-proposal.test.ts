import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { advanceReviewRun } from "../executor";

vi.mock("../guard", () => ({
  isContractReviewEnabled: vi.fn(async () => true),
  isProposalReviewEnabled: vi.fn(async () => true),
}));
vi.mock("@/lib/google/docs", () => ({ getDocPlainText: vi.fn() }));
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
vi.mock("@/lib/proposals/events", () => ({
  logProposalEvent: vi.fn(async () => undefined),
}));

import { isProposalReviewEnabled } from "../guard";
import { runContractReviewLlm } from "../reviewer";
import { logProposalEvent } from "@/lib/proposals/events";

const runUpdateMany = prisma.contractReviewRun.updateMany as ReturnType<typeof vi.fn>;
const runFindUniqueOrThrow = prisma.contractReviewRun.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const runUpdate = prisma.contractReviewRun.update as ReturnType<typeof vi.fn>;
const proposalFindUnique = prisma.proposal.findUnique as ReturnType<typeof vi.fn>;
const eventFindMany = prisma.proposalEvent.findMany as ReturnType<typeof vi.fn>;

const RUN = { id: "run1", orgId: "org1", contractId: null, proposalId: "p1", attempt: 1 };

function mockProposal(overrides: Record<string, unknown> = {}) {
  proposalFindUnique.mockResolvedValue({
    id: "p1",
    kind: "locacao",
    schemaType: "locacao_residencial_v1",
    dataJson: { locacao: { valor_aluguel: 2500 } },
    sentSnapshotHtml: "<p>Proposta de locação — aluguel de R$ 2.500,00 mensais.</p>",
    sentSnapshotHash: "hash-1",
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runUpdateMany.mockResolvedValue({ count: 1 });
  runFindUniqueOrThrow.mockResolvedValue(RUN);
  runUpdate.mockResolvedValue({});
  eventFindMany.mockResolvedValue([]);
  (isProposalReviewEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (runContractReviewLlm as ReturnType<typeof vi.fn>).mockResolvedValue({
    findings: [],
    documentOk: true,
    violations: [],
    steps: [],
    retried: false,
  });
});

describe("advanceReviewRun — alvo proposta", () => {
  it("caminho feliz: revisa o snapshot, grava UM evento review_completed e fecha done", async () => {
    mockProposal();
    (runContractReviewLlm as ReturnType<typeof vi.fn>).mockResolvedValue({
      findings: [
        {
          category: "dados_form",
          severity: "warning",
          title: "Aluguel divergente",
          finding: "Form R$ 2.300 × texto R$ 2.500.",
          selectedText: "aluguel de R$ 2.500,00",
        },
      ],
      documentOk: false,
      violations: [],
      steps: [
        {
          model: "claude-sonnet-5",
          usage: { promptTokens: 8000, completionTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 1000 },
          latencyMs: 800,
        },
      ],
      retried: false,
    });

    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("done");

    expect(logProposalEvent).toHaveBeenCalledTimes(1);
    const [proposalId, eventName, payload] = (logProposalEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(proposalId).toBe("p1");
    expect(eventName).toBe("review_completed");
    expect(payload.snapshotHash).toBe("hash-1");
    expect(payload.findings).toHaveLength(1);
    // detail da timeline sai de issues[].reason
    expect(payload.issues[0].reason).toContain("Aluguel divergente");
    // família do playbook = proposta
    const llmCall = (runContractReviewLlm as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(llmCall.family).toBe("proposta");
    // custo acumulado no run
    const costUpdate = runUpdate.mock.calls.find((c) => c[0].data?.aiCostUsd !== undefined);
    expect(costUpdate![0].data.aiCostUsd).toBeGreaterThan(0);
  });

  it("mesmo snapshotHash já revisado → skipped already-reviewed (reenvio sem mudança não paga de novo)", async () => {
    mockProposal();
    eventFindMany.mockResolvedValue([{ payload: { snapshotHash: "hash-1" } }]);
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("already-reviewed");
    expect(runContractReviewLlm).not.toHaveBeenCalled();
    expect(logProposalEvent).not.toHaveBeenCalled();
  });

  it("proposta sem snapshot (nunca enviada) → skipped no-snapshot", async () => {
    mockProposal({ sentSnapshotHtml: null });
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no-snapshot");
  });

  it("flag de proposta desligada → skipped", async () => {
    mockProposal();
    (isProposalReviewEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await advanceReviewRun("run1");
    expect(result.reason).toBe("feature-disabled");
  });

  it("achados de revisões anteriores entram como já-apontado (anti-duplicação)", async () => {
    mockProposal({ sentSnapshotHash: "hash-2" });
    eventFindMany.mockResolvedValue([
      {
        payload: {
          snapshotHash: "hash-1",
          findings: [{ title: "Antigo", selectedText: "trecho antigo" }],
        },
      },
    ]);
    await advanceReviewRun("run1");
    const llmCall = (runContractReviewLlm as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(llmCall.existingComments).toEqual([{ text: "Antigo", selectedText: "trecho antigo" }]);
  });

  it("zero achados → evento com reason de documento limpo", async () => {
    mockProposal();
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("done");
    const payload = (logProposalEvent as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(payload.reason).toMatch(/Nenhuma divergência/);
    expect(payload.issues).toBeUndefined();
  });

  it("erro de API → run devolvido a queued", async () => {
    mockProposal();
    (runContractReviewLlm as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("api down"));
    const result = await advanceReviewRun("run1");
    expect(result.status).toBe("queued");
    expect(result.reason).toBe("llm-retry");
    expect(logProposalEvent).not.toHaveBeenCalled();
  });
});
