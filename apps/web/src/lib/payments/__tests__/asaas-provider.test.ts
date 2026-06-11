import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocka só o asaasFetch (mantém o resto do client real). Os wrappers de
// lib/asaas/{payments,customers,transfers} delegam pra ele.
const { asaasFetchMock } = vi.hoisted(() => ({ asaasFetchMock: vi.fn() }));
vi.mock("@/lib/asaas/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/asaas/client")>();
  return { ...actual, asaasFetch: asaasFetchMock };
});

import { AsaasProvider } from "@/lib/payments/asaas-provider";
import { getPaymentProvider } from "@/lib/payments";

describe("AsaasProvider (PaymentProvider seam)", () => {
  beforeEach(() => asaasFetchMock.mockReset());

  it("getPaymentProvider retorna um AsaasProvider", () => {
    const p = getPaymentProvider({ apiKey: "k" });
    expect(p.name).toBe("asaas");
    expect(p).toBeInstanceOf(AsaasProvider);
  });

  it("createCharge mapeia DTO neutro → POST /payments e devolve Charge", async () => {
    asaasFetchMock.mockResolvedValue({
      id: "pay_1",
      object: "payment",
      customer: "cus_1",
      value: 1000,
      netValue: 980,
      status: "PENDING",
      billingType: "PIX",
      dueDate: "2026-06-01",
      invoiceUrl: "https://inv",
      bankSlipUrl: null,
      externalReference: "deal_1",
      dateCreated: "2026-05-25",
    });

    const charge = await new AsaasProvider("apikey-123").createCharge({
      customerId: "cus_1",
      billingType: "PIX",
      value: 1000,
      dueDate: "2026-06-01",
      externalReference: "deal_1",
      splits: [{ walletId: "w1", percentualValue: 10 }],
    });

    const [path, opts] = asaasFetchMock.mock.calls[0];
    expect(path).toBe("/payments");
    expect(opts.method).toBe("POST");
    expect(opts.apiKey).toBe("apikey-123");
    expect(opts.body.customer).toBe("cus_1");
    expect(opts.body.split).toEqual([{ walletId: "w1", percentualValue: 10 }]);

    expect(charge).toEqual({
      id: "pay_1",
      customerId: "cus_1",
      value: 1000,
      netValue: 980,
      status: "PENDING",
      billingType: "PIX",
      dueDate: "2026-06-01",
      invoiceUrl: "https://inv",
      bankSlipUrl: null,
      externalReference: "deal_1",
    });
  });

  it("cancelCharge delega DELETE /payments/:id", async () => {
    asaasFetchMock.mockResolvedValue({ deleted: true, id: "pay_1" });
    const res = await new AsaasProvider("k").cancelCharge("pay_1");
    expect(asaasFetchMock.mock.calls[0][0]).toBe("/payments/pay_1");
    expect(res).toEqual({ deleted: true, id: "pay_1" });
  });

  it("createTransfer mapeia PIX → POST /transfers", async () => {
    asaasFetchMock.mockResolvedValue({
      id: "tr_1",
      object: "transfer",
      status: "PENDING",
      value: 500,
      type: "PIX",
      dateCreated: "2026-05-25",
    });
    const t = await new AsaasProvider("k").createTransfer({
      value: 500,
      pixAddressKey: "chave@pix",
      pixAddressKeyType: "EMAIL",
    });
    expect(asaasFetchMock.mock.calls[0][0]).toBe("/transfers");
    expect(t).toEqual({ id: "tr_1", status: "PENDING", value: 500 });
  });
});
