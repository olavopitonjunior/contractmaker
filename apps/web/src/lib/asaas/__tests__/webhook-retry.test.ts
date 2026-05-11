import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests para o comportamento de force-retry e tratamento de eventos
 * non-payment em `applyWebhookToCharge`.
 *
 * Mocks pesados de Prisma — testamos a árvore de decisões (early returns,
 * upsert vs create, idempotência) sem hidratar DB real.
 */

// Mock prisma + dispatcher
const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockCommissionFindUnique = vi.fn();
const mockTransfersFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockDispatchExternalSplits = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockAccountUpdate = vi.fn();
const mockNotifyChargeEvent = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    asaasWebhookEvent: {
      findUnique: (args: unknown) => mockFindUnique(args),
      upsert: (args: unknown) => mockUpsert(args),
    },
    commissionCharge: {
      findUnique: (args: unknown) => mockCommissionFindUnique(args),
      update: (args: unknown) => mockUpdate(args),
    },
    asaasTransfer: {
      findUnique: (args: unknown) => mockTransfersFindUnique(args),
    },
    asaasAccount: {
      findFirst: (args: unknown) => mockAccountFindFirst(args),
      update: (args: unknown) => mockAccountUpdate(args),
    },
    $transaction: (fn: (tx: unknown) => unknown) =>
      mockTransaction(fn) ??
      fn({
        asaasWebhookEvent: {
          upsert: (args: unknown) => mockUpsert(args),
          create: (args: unknown) => mockUpsert(args),
        },
        commissionCharge: {
          update: (args: unknown) => mockUpdate(args),
        },
      }),
  },
}));

vi.mock("@/lib/asaas/splitDispatcher", () => ({
  dispatchExternalSplits: (id: string) => {
    mockDispatchExternalSplits(id);
    return Promise.resolve({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    });
  },
}));

vi.mock("@/lib/financeiro/notifications", () => ({
  notifyChargeEvent: (...args: unknown[]) => {
    mockNotifyChargeEvent(...args);
    return Promise.resolve();
  },
}));

import { applyWebhookToCharge } from "../webhook";

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockUpdate.mockReset();
  mockCommissionFindUnique.mockReset();
  mockTransfersFindUnique.mockReset();
  mockTransaction.mockReset();
  mockDispatchExternalSplits.mockReset();
  mockAccountFindFirst.mockReset();
  mockAccountUpdate.mockReset();
  mockNotifyChargeEvent.mockReset();
});

const basePaymentPayload = {
  id: "evt_001",
  event: "PAYMENT_RECEIVED",
  payment: {
    id: "pay_xxx",
    status: "RECEIVED",
    paymentDate: "2026-04-25",
    netValue: 99.0,
  },
} as any;

describe("applyWebhookToCharge — dedupe sem force", () => {
  it("skip se evento já existe (qualquer estado)", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "x",
      processedAt: new Date(),
      processingError: null,
    });

    const result = await applyWebhookToCharge(basePaymentPayload);
    expect(result.processed).toBe(false);
    expect(result.reason).toContain("duplicate");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("skip mesmo se evento existir só com processingError", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "x",
      processedAt: null,
      processingError: "Prisma timeout",
    });

    const result = await applyWebhookToCharge(basePaymentPayload);
    expect(result.processed).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("applyWebhookToCharge — force=true", () => {
  it("skip se já está processedAt sem error (sucesso confirmado)", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "x",
      processedAt: new Date(),
      processingError: null,
    });

    const result = await applyWebhookToCharge(basePaymentPayload, {
      force: true,
    });
    expect(result.processed).toBe(false);
    expect(result.reason).toContain("already successfully processed");
  });

  it("reprocessa se evento existir com processingError", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "x",
      processedAt: null,
      processingError: "Prisma timeout",
    });
    mockCommissionFindUnique.mockResolvedValueOnce({
      id: "ch_1",
      orgId: "org_1",
      paidAt: null,
      netValue: null,
      refundedAt: null,
      cancelledAt: null,
    });

    const result = await applyWebhookToCharge(basePaymentPayload, {
      force: true,
    });
    expect(result.processed).toBe(true);
    expect(mockUpsert).toHaveBeenCalled();
  });

  it("reprocessa se evento existir mas processedAt null", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "x",
      processedAt: null,
      processingError: null,
    });
    mockCommissionFindUnique.mockResolvedValueOnce({
      id: "ch_1",
      orgId: "org_1",
      paidAt: null,
      netValue: null,
      refundedAt: null,
      cancelledAt: null,
    });

    const result = await applyWebhookToCharge(basePaymentPayload, {
      force: true,
    });
    expect(result.processed).toBe(true);
  });
});

describe("applyWebhookToCharge — eventos non-payment", () => {
  const transferPayload = {
    id: "evt_t1",
    event: "TRANSFER_DONE",
    transfer: { id: "tra_xxx" },
  } as any;

  it("loga TRANSFER_DONE quando consegue inferir orgId via AsaasTransfer", async () => {
    mockFindUnique.mockResolvedValueOnce(null); // não existe ainda
    mockTransfersFindUnique.mockResolvedValueOnce({ orgId: "org_1" });

    const result = await applyWebhookToCharge(transferPayload);
    expect(result.processed).toBe(true);
    expect(result.reason).toContain("logged");
    expect(mockUpsert).toHaveBeenCalled();
  });

  it("skip TRANSFER_DONE quando não consegue inferir orgId", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockTransfersFindUnique.mockResolvedValueOnce(null);

    const result = await applyWebhookToCharge(transferPayload);
    expect(result.processed).toBe(false);
    expect(result.reason).toContain("inferable orgId");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("upsert idempotente em retry de evento non-payment já logado", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "x",
      processedAt: new Date(),
      processingError: null,
    });

    const result = await applyWebhookToCharge(transferPayload, { force: true });
    // já está successfully processed → skip
    expect(result.processed).toBe(false);
  });
});

describe("applyWebhookToCharge — ACCOUNT_STATUS_UPDATED", () => {
  const accountStatusPayload = {
    id: "evt_acc_001",
    event: "ACCOUNT_STATUS_UPDATED",
    account: {
      id: "asaas_acc_xyz",
      status: {
        general: "APPROVED",
        documentation: "APPROVED",
        commercialInfo: "APPROVED",
        bankAccountInfo: "APPROVED",
      },
    },
  } as any;

  it("resolve AsaasAccount via asaasId externo e atualiza os 4 status fields", async () => {
    mockFindUnique.mockResolvedValueOnce(null); // evento novo
    mockAccountFindFirst.mockResolvedValueOnce({
      id: "local_acc_1",
      orgId: "org_1",
      status: "PENDING",
    });
    mockAccountUpdate.mockResolvedValueOnce({});

    const result = await applyWebhookToCharge(accountStatusPayload);

    expect(mockAccountFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { asaasId: "asaas_acc_xyz" },
      })
    );
    // Update inclui os 4 sub-statuses + general APPROVED dispara status=APPROVED+approvedAt
    expect(mockAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "local_acc_1" },
        data: expect.objectContaining({
          generalStatus: "APPROVED",
          documentationStatus: "APPROVED",
          commercialInfoStatus: "APPROVED",
          bankAccountInfoStatus: "APPROVED",
          status: "APPROVED",
          approvedAt: expect.any(Date),
          lastStatusCheckAt: expect.any(Date),
        }),
      })
    );
    // Loga em AsaasWebhookEvent com accountId populado
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          accountId: "local_acc_1",
          orgId: "org_1",
          event: "ACCOUNT_STATUS_UPDATED",
        }),
      })
    );
    expect(result.processed).toBe(true);
  });

  it("não promove status quando general continua PENDING", async () => {
    const partialPayload = {
      ...accountStatusPayload,
      id: "evt_acc_002",
      account: {
        ...accountStatusPayload.account,
        status: {
          general: "PENDING",
          documentation: "PENDING",
          commercialInfo: "APPROVED",
        },
      },
    };
    mockFindUnique.mockResolvedValueOnce(null);
    mockAccountFindFirst.mockResolvedValueOnce({
      id: "local_acc_1",
      orgId: "org_1",
      status: "PENDING",
    });
    mockAccountUpdate.mockResolvedValueOnce({});

    await applyWebhookToCharge(partialPayload);

    // Quando ainda PENDING + documentation pendente → eleva pra AWAITING_APPROVAL
    expect(mockAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          generalStatus: "PENDING",
          status: "AWAITING_APPROVAL",
        }),
      })
    );
    // approvedAt NÃO deve ser setado quando general != APPROVED
    const call = mockAccountUpdate.mock.calls[0][0];
    expect(call.data.approvedAt).toBeUndefined();
  });

  it("skip silencioso se account.id externo não bate com nenhuma conta local", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockAccountFindFirst.mockResolvedValueOnce(null);

    const result = await applyWebhookToCharge(accountStatusPayload);

    expect(mockAccountUpdate).not.toHaveBeenCalled();
    expect(result.processed).toBe(false);
    expect(result.reason).toMatch(/inferable orgId/i);
  });
});

describe("applyWebhookToCharge — PAYMENT_* popula accountId em AsaasWebhookEvent", () => {
  it("evento PAYMENT_RECEIVED com charge.accountId persistido escreve accountId no log", async () => {
    mockFindUnique.mockResolvedValueOnce(null); // evento novo
    mockCommissionFindUnique.mockResolvedValueOnce({
      id: "ch_1",
      orgId: "org_1",
      accountId: "local_acc_99",
      paidAt: null,
      netValue: null,
      refundedAt: null,
      cancelledAt: null,
    });

    const payload = {
      id: "evt_pay_001",
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "pay_zzz",
        status: "RECEIVED",
        paymentDate: "2026-05-10",
        netValue: 99.0,
      },
    } as any;

    await applyWebhookToCharge(payload);

    // O upsert do AsaasWebhookEvent dentro da transação recebe accountId
    const upsertCalls = mockUpsert.mock.calls;
    const eventUpsert = upsertCalls.find((c) => {
      const args = c[0] as { create?: { event?: string } };
      return args?.create?.event === "PAYMENT_RECEIVED";
    });
    expect(eventUpsert).toBeTruthy();
    expect((eventUpsert![0] as any).create.accountId).toBe("local_acc_99");
  });
});
