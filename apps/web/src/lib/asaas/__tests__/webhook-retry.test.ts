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

import { applyWebhookToCharge } from "../webhook";

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockUpdate.mockReset();
  mockCommissionFindUnique.mockReset();
  mockTransfersFindUnique.mockReset();
  mockTransaction.mockReset();
  mockDispatchExternalSplits.mockReset();
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
