import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exclusividade Asaas × Superlógica no SERVIDOR (decisão de produto de 03/09/2026):
 * negócio já exportado tem a comissão cobrada pela Superlógica, então nenhuma
 * cobrança Asaas pode nascer dele — por porta nenhuma (tela, bearer, Max).
 *
 * O guard mora em `runCreateCommissionCharge`, e o smoke em staging NÃO consegue
 * exercê-lo: a rota resolve a conta Asaas antes e devolve 422 numa org sem conta.
 * Sem este teste, a regra que evita cobrar o cliente DUAS VEZES não tem oráculo.
 */

const m = vi.hoisted(() => ({
  prisma: {
    deal: { findFirst: vi.fn() },
    asaasAccount: { findFirst: vi.fn() },
    // Cinto de segurança: hoje os controles morrem na checagem de conta, ANTES
    // do guard de cobrança duplicada. Se alguém inverter essa ordem, sem este
    // mock o teste quebraria por TypeError — falha opaca em vez de asserção.
    commissionCharge: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

/** Mensagem exata da recusa por conta Asaas — é onde os controles devem morrer. */
const SEM_CONTA = "Conta Asaas inválida ou inacessível";

vi.mock("@/lib/db/prisma", () => ({ prisma: m.prisma }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: unknown) => p }));
vi.mock("@/lib/pipeline/move-stage", () => ({ moveDealStage: vi.fn() }));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/notifications/deal-events", () => ({ notifyDealEvent: vi.fn() }));
vi.mock("@/lib/asaas/customers", () => ({ upsertCustomer: vi.fn() }));
vi.mock("@/lib/asaas/account", () => ({ getAccountWithApiKey: vi.fn() }));
vi.mock("@/lib/asaas/platform-fee", () => ({ resolvePlatformFee: vi.fn() }));
vi.mock("@/lib/asaas/payments", () => ({
  createPayment: vi.fn(),
  getPixQrCode: vi.fn(),
  getBankSlipData: vi.fn(),
}));
vi.mock("@/lib/financeiro/notifications", () => ({ notifyChargeEvent: vi.fn() }));

import { runCreateCommissionCharge } from "@/lib/asaas/charges-action";

const INPUT = {
  orgId: "org-1",
  dealId: "deal-1",
  userId: "user-1",
  accountId: "acct-1",
  billingType: "BOLETO" as const,
  dueDate: "2026-09-20",
};

/** Deal com um contrato aprovado — o caminho normal segue adiante daqui. */
function dealRow(superlogicaExport: { status: string; vendaId: string | null } | null) {
  return {
    id: "deal-1",
    title: "Negócio",
    contracts: [{ id: "c1", status: "aprovado", version: 1 }],
    superlogicaExport,
  };
}

describe("runCreateCommissionCharge — exclusividade com a Superlógica", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recusa com 409 quando a venda já foi exportada", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ status: "done", vendaId: "746" }));

    const out = await runCreateCommissionCharge({ ...INPUT } as never);

    expect(out.status).toBe(409);
    // A mensagem é o que o corretor lê na tela: precisa dizer ONDE a comissão
    // está sendo cobrada, e qual venda. Asserir o corpo, não só o status —
    // um teste que asserta só "409" passaria com o guard deletado.
    expect(String((out.body as { error?: string }).error)).toContain("746");
    expect(String((out.body as { error?: string }).error)).toContain("Superlógica");
  });

  it("segue adiante quando a exportação não terminou (running) ou falhou (error)", async () => {
    for (const status of ["running", "error"]) {
      vi.clearAllMocks();
      m.prisma.deal.findFirst.mockResolvedValue(dealRow({ status, vendaId: null }));
      m.prisma.asaasAccount.findFirst.mockResolvedValue(null);

      const out = await runCreateCommissionCharge({ ...INPUT } as never);

      // Controle: passou do guard da Superlógica e morreu na checagem de conta
      // Asaas. Status e mensagem EXATOS — um `not.toBe(409)` passaria também
      // com um 500 por crash, provando nada.
      expect(out.status).toBe(422);
      expect((out.body as { error?: string }).error).toBe(SEM_CONTA);
    }
  });

  it("segue adiante quando o negócio nunca foi exportado", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow(null));
    m.prisma.asaasAccount.findFirst.mockResolvedValue(null);

    const out = await runCreateCommissionCharge({ ...INPUT } as never);

    expect(out.status).toBe(422);
    expect((out.body as { error?: string }).error).toBe(SEM_CONTA);
  });
});
