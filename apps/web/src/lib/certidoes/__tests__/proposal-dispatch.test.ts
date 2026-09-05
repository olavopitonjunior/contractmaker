import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../executor", () => ({
  runBatch: vi.fn().mockResolvedValue(undefined),
  getMonthlySpend: vi.fn().mockResolvedValue({ spentCents: 0, budgetCents: 100_000, exceeded: false }),
}));
vi.mock("../govbr-auth", () => ({ checkGovBrAuth: vi.fn(async () => ({ active: false })) }));
vi.mock("../onr-auth", () => ({ checkOnrAuth: vi.fn(async () => ({ active: false })) }));
vi.mock("../planner", () => ({
  planCertidoesForDeal: vi.fn(),
}));
vi.mock("@/lib/security/budget-lock", () => ({
  withOrgBudgetLock: vi.fn(async (_ns: string, _org: string, fn: (tx: unknown) => Promise<unknown>) => {
    const { prisma } = await import("@/lib/db/prisma");
    return fn(prisma);
  }),
}));

import { dispatchProposalCertidoes, stripSerasa } from "../proposal-dispatch";
import { planCertidoesForDeal } from "../planner";
import { runBatch, getMonthlySpend } from "../executor";
import { prisma } from "@/lib/db/prisma";

const mockPlan = vi.mocked(planCertidoesForDeal);
const mockRunBatch = vi.mocked(runBatch);
const mockSpend = vi.mocked(getMonthlySpend);
const jobFindMany = prisma.certidaoJob.findMany as unknown as ReturnType<typeof vi.fn>;
const jobAggregate = prisma.certidaoJob.aggregate as unknown as ReturnType<typeof vi.fn>;
const jobCreate = prisma.certidaoJob.create as unknown as ReturnType<typeof vi.fn>;
const jobUpdateMany = prisma.certidaoJob.updateMany as unknown as ReturnType<typeof vi.fn>;

const PLAN = {
  totalCostCents: 1300,
  jobs: [
    { endpoint: "tribunais/cndt", label: "CNDT — Maria", targetKind: "locatario", targetIndex: 0, requestPayload: { cpf: "1" }, costCents: 300 },
    { endpoint: "serasa/pf/score", label: "Serasa — Maria", targetKind: "locatario", targetIndex: 0, requestPayload: { cpf: "1" }, costCents: 1000 },
  ],
  skipped: [
    {
      endpoint: "receita-federal/pgfn",
      label: "PGFN — Maria",
      targetKind: "locatario",
      targetIndex: 0,
      reason: "Falta data de nascimento",
      missingField: "locatarios.0.data_nascimento",
      missingFields: [{ path: "locatarios.0.data_nascimento", label: "Nascimento", type: "date" }],
    },
  ],
};

const INPUT = {
  proposalId: "p1",
  orgId: "org1",
  userId: "u1",
  userEmail: "op@x.com",
  esteira: "locacao" as const,
  dataJson: { locatarios: [{ nome: "Maria", cpf: "52998224725" }] },
  batchId: "batch-0001",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPlan.mockReturnValue(PLAN as never);
  mockSpend.mockResolvedValue({ spentCents: 0, budgetCents: 100_000, exceeded: false } as never);
  jobFindMany.mockResolvedValue([]);
  jobAggregate.mockResolvedValue({ _sum: { costCents: 0 } });
  jobCreate.mockResolvedValue({ id: "j1" });
  jobUpdateMany.mockResolvedValue({ count: 0 });
});

describe("stripSerasa — a proposta não consulta Serasa (a análise de crédito é a Ficha Certa)", () => {
  it("remove jobs de provider serasa e recalcula o custo", () => {
    const out = stripSerasa(PLAN as never);
    expect(out.jobs.map((j) => j.endpoint)).toEqual(["tribunais/cndt"]);
    expect(out.totalCostCents).toBe(300);
    expect(out.skipped).toHaveLength(1);
  });
});

describe("dispatchProposalCertidoes", () => {
  it("cria jobs com proposalId/orgId (sem dealId), persiste o pulado, e dispara runBatch(batchId, null)", async () => {
    const r = await dispatchProposalCertidoes(INPUT);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ batchId: "batch-0001", jobCount: 1, totalCostCents: 300 });

    expect(jobCreate).toHaveBeenCalledTimes(2);
    const created = jobCreate.mock.calls.map((c) => c[0].data);
    const live = created.find((d) => d.status !== "skipped")!;
    expect(live).toMatchObject({ proposalId: "p1", orgId: "org1", userId: "u1", endpoint: "tribunais/cndt", provider: "infosimples" });
    expect(live).not.toHaveProperty("dealId");
    // Serasa não entrou
    expect(created.some((d) => String(d.endpoint).startsWith("serasa/"))).toBe(false);
    const skipped = created.find((d) => d.status === "skipped")!;
    expect(skipped).toMatchObject({ proposalId: "p1", missingFields: ["locatarios.0.data_nascimento"], costCents: 0 });

    // supersede escopado à proposta
    expect(jobUpdateMany.mock.calls.every((c) => c[0].where.proposalId === "p1")).toBe(true);
    // O lote NÃO roda dentro da lib: o caller é quem executa `run()` sob waitUntil.
    expect(mockRunBatch).not.toHaveBeenCalled();
    if (r.ok) await r.run();
    expect(mockRunBatch).toHaveBeenCalledWith("batch-0001", null);
    // planner chamado com esteira e e-mail do operador (e-SAJ)
    expect(mockPlan.mock.calls[0][1]).toBe("op@x.com");
    expect(mockPlan.mock.calls[0][3]).toMatchObject({ esteira: "locacao", expandAll: false });
  });

  it("budget mensal estourado → 402 antes de planejar", async () => {
    mockSpend.mockResolvedValue({ spentCents: 100_000, budgetCents: 100_000, exceeded: true } as never);
    const r = await dispatchProposalCertidoes(INPUT);
    expect(r).toMatchObject({ ok: false, status: 402 });
    expect(mockPlan).not.toHaveBeenCalled();
    expect(jobCreate).not.toHaveBeenCalled();
  });

  it("lote estouraria o budget (re-leitura sob o lock) → 402, nada criado", async () => {
    jobAggregate.mockResolvedValue({ _sum: { costCents: 99_900 } });
    const r = await dispatchProposalCertidoes(INPUT);
    expect(r).toMatchObject({ ok: false, status: 402 });
    expect(jobCreate).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty("run");
  });

  it("alvo genuinamente em andamento não é redisparado; tudo em andamento → 409", async () => {
    jobFindMany.mockResolvedValue([
      { endpoint: "tribunais/cndt", targetKind: "locatario", targetIndex: 0, status: "pending", retryCount: 0, maxRetries: 3, createdAt: new Date(), resultData: null },
    ]);
    const r = await dispatchProposalCertidoes({ ...INPUT, selectedJobs: [{ endpoint: "tribunais/cndt", targetKind: "locatario", targetIndex: 0 }] });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(jobCreate).not.toHaveBeenCalled();
  });

  it("seleção explícita: só o pedido é criado; seleção que o plano não constrói vira `unmatched`", async () => {
    const r = await dispatchProposalCertidoes({
      ...INPUT,
      selectedJobs: [
        { endpoint: "tribunais/cndt", targetKind: "locatario", targetIndex: 0 },
        { endpoint: "inexistente/x", targetKind: "locatario", targetIndex: 0 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.body.unmatched).toEqual([{ endpoint: "inexistente/x", targetKind: "locatario", targetIndex: 0 }]);
    expect(jobCreate).toHaveBeenCalledTimes(1);
    expect(mockPlan.mock.calls[0][3]).toMatchObject({ expandAll: true });
  });
});
