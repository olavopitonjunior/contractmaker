import { describe, it, expect, vi, beforeEach } from "vitest";

// Prisma local só com o que buildServiceHealth usa.
const { db } = vi.hoisted(() => ({
  db: {
    certidaoJob: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { buildServiceHealth } from "../service-health";

const OK = { status: "success", resultCode: 200, errorMessage: null, resultData: {}, retryCount: 0 };
// status data_missing → bucket "dado_faltante" (problema, conta contra a taxa).
const PROBLEMA = { status: "data_missing", resultCode: 606, errorMessage: "falta CPF", resultData: null, retryCount: 0 };

// aggregate determinístico por provider (Promise.all torna a ordem imprevisível).
function mockBudget(infosimplesCents: number, serasaCents = 0) {
  db.certidaoJob.aggregate.mockImplementation((args: { where: { provider: string } }) =>
    Promise.resolve({
      _sum: { costCents: args.where.provider === "serasa" ? serasaCents : infosimplesCents },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INFOSIMPLES_MONTHLY_BUDGET_CENTS = "20000"; // R$ 200
});

describe("buildServiceHealth", () => {
  it("reporta guard OK, orçamento e taxa de sucesso; omite Serasa sem gasto", async () => {
    db.certidaoJob.findMany
      .mockResolvedValueOnce([OK, OK, OK, PROBLEMA]) // 3 ok / 1 problema → 75%
      .mockResolvedValueOnce([]); // guardState: sem 603/604 recente
    mockBudget(5000); // infosimples R$ 50 de R$ 200 = 25%

    const h = await buildServiceHealth("org1");
    expect(h.degraded).toBe(false);
    expect(h.text).toContain("Saúde do serviço: OK");
    expect(h.text).toContain("25%");
    expect(h.text).toContain("Taxa de sucesso (24h): 75%");
    expect(h.text).not.toContain("Serasa");
    expect(h.html).toContain("<strong>Saúde do serviço:</strong>");
  });

  it("marca degraded=BLOQUEADO quando o orçamento estoura", async () => {
    db.certidaoJob.findMany.mockResolvedValueOnce([OK]).mockResolvedValueOnce([]);
    mockBudget(25000); // R$ 250 > R$ 200

    const h = await buildServiceHealth("org1");
    expect(h.degraded).toBe(true);
    expect(h.text).toContain("BLOQUEADO — orçamento mensal Infosimples estourado");
  });

  it("marca crédito esgotado com 603/604 genuíno recente", async () => {
    db.certidaoJob.findMany.mockResolvedValueOnce([OK]).mockResolvedValueOnce([
      { resultMessage: "sem saldo para consulta", errorMessage: null },
    ]);
    mockBudget(1000); // dentro do orçamento — degradação vem do crédito, não do budget

    const h = await buildServiceHealth("org1");
    expect(h.degraded).toBe(true);
    expect(h.text).toContain("crédito Infosimples esgotado");
  });
});
