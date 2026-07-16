import { describe, it, expect } from "vitest";
import { composeSplits, CommissionBuildError } from "../commission";
import type { SplitInputEntry, ExternalSplit } from "../commission";
import { computeAmount } from "../splitDispatcher";

function extPix(percentualValue?: number, fixedValue?: number): ExternalSplit {
  return {
    recipientId: "rec",
    pixAddressKey: "12345678901",
    pixKeyType: "CPF",
    ownerName: "Owner",
    ownerCpfCnpj: "12345678901",
    percentualValue,
    fixedValue,
  };
}

const ORG_WALLET = "org-wallet-uuid-xxx";
const PLATFORM_WALLET = "platform-wallet-uuid-yyy";
const CORRETORA = "corretora-wallet-uuid";
const VENDEDOR = "vendedor-wallet-uuid";

function wallet(walletId: string, percentualValue: number): SplitInputEntry {
  return { recipientType: "asaas_wallet", walletId, percentualValue };
}

function pix(
  recipientId: string,
  pixAddressKey: string,
  percentualValue: number
): SplitInputEntry {
  return {
    recipientType: "pix_external",
    recipientId,
    pixAddressKey,
    pixKeyType: "CPF",
    ownerName: "Test Owner",
    ownerCpfCnpj: "12345678901",
    percentualValue,
  };
}

describe("composeSplits — Fase 5 (back-compat: walletId only)", () => {
  it("retorna {asaasSplits: undefined, externalSplits: []} se nada configurado", () => {
    const out = composeSplits({ orgWalletId: ORG_WALLET });
    expect(out.asaasSplits).toBeUndefined();
    expect(out.externalSplits).toEqual([]);
  });

  it("retorna asaasSplits=undefined se platform fee é 0 sem custom splits", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      platformFeePercent: 0,
      platformWalletId: PLATFORM_WALLET,
    });
    expect(out.asaasSplits).toBeUndefined();
  });

  it("retorna asaasSplits=undefined se platform fee > 0 mas wallet ID ausente", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      platformFeePercent: 5,
      platformWalletId: null,
    });
    expect(out.asaasSplits).toBeUndefined();
  });

  it("gera split só da plataforma quando custom é vazio", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      platformFeePercent: 5,
      platformWalletId: PLATFORM_WALLET,
    });
    expect(out.asaasSplits).toHaveLength(1);
    expect(out.asaasSplits?.[0]).toMatchObject({
      walletId: PLATFORM_WALLET,
      percentualValue: 5,
    });
  });

  it("concatena custom splits + platform fee", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      customSplits: [wallet(CORRETORA, 60), wallet(VENDEDOR, 30)],
      platformFeePercent: 5,
      platformWalletId: PLATFORM_WALLET,
    });
    expect(out.asaasSplits).toHaveLength(3);
    expect(out.asaasSplits?.[0].walletId).toBe(CORRETORA);
    expect(out.asaasSplits?.[1].walletId).toBe(VENDEDOR);
    expect(out.asaasSplits?.[2].walletId).toBe(PLATFORM_WALLET);
    expect(out.externalSplits).toEqual([]);
  });

  it("aceita soma exata de 100% (remainder zero)", () => {
    expect(() =>
      composeSplits({
        orgWalletId: ORG_WALLET,
        customSplits: [wallet(CORRETORA, 70), wallet(VENDEDOR, 30)],
      })
    ).not.toThrow();
  });

  function expectSplitError(fn: () => unknown, code: string): CommissionBuildError {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(CommissionBuildError);
      const cbe = err as CommissionBuildError;
      expect(cbe.code).toBe(code);
      return cbe;
    }
    throw new Error("Esperava exceção, nenhuma lançada");
  }

  it("rejeita quando custom+platform ultrapassa 100%", () => {
    expectSplitError(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [wallet(CORRETORA, 60), wallet(VENDEDOR, 35)],
          platformFeePercent: 10,
          platformWalletId: PLATFORM_WALLET,
        }),
      "SPLIT_PERCENT_OVERFLOW"
    );
  });

  it("rejeita split com wallet ID duplicado", () => {
    expectSplitError(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [wallet(CORRETORA, 50), wallet(CORRETORA, 20)],
        }),
      "SPLIT_DUPLICATE_WALLET"
    );
  });

  it("rejeita split para wallet da própria org", () => {
    expectSplitError(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [wallet(ORG_WALLET, 10)],
        }),
      "SPLIT_SELF_WALLET"
    );
  });

  it("rejeita entry sem percentualValue nem fixedValue", () => {
    expectSplitError(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [wallet(CORRETORA, 0)],
        }),
      "SPLIT_EMPTY_VALUE"
    );
  });

  it("rejeita entry com percentualValue E fixedValue juntos (S-2)", () => {
    expectSplitError(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [
            {
              recipientType: "asaas_wallet",
              walletId: CORRETORA,
              percentualValue: 30,
              fixedValue: 1000,
            },
          ],
        }),
      "SPLIT_MIXED_VALUE"
    );
  });

  it("aceita entry com fixedValue sem percentualValue", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      customSplits: [
        {
          recipientType: "asaas_wallet",
          walletId: CORRETORA,
          fixedValue: 100,
        },
      ],
    });
    expect(out.asaasSplits).toHaveLength(1);
    expect(out.asaasSplits?.[0].fixedValue).toBe(100);
  });

  it("rejeita mais de 10 destinatários Asaas", () => {
    const many: SplitInputEntry[] = Array.from({ length: 11 }, (_, i) =>
      wallet(`wallet-${i}`, 1)
    );
    expectSplitError(
      () => composeSplits({ orgWalletId: ORG_WALLET, customSplits: many }),
      "SPLIT_TOO_MANY"
    );
  });

  it("exatamente 10 destinatários é OK", () => {
    const exactly: SplitInputEntry[] = Array.from({ length: 10 }, (_, i) =>
      wallet(`wallet-${i}`, 5)
    );
    expect(() =>
      composeSplits({ orgWalletId: ORG_WALLET, customSplits: exactly })
    ).not.toThrow();
  });
});

describe("composeSplits — Fase 6 (PIX externos)", () => {
  it("entrada PIX vai para externalSplits, não para asaasSplits", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      customSplits: [pix("rec-pix-1", "12345678901", 30)],
    });
    expect(out.asaasSplits).toBeUndefined();
    expect(out.externalSplits).toHaveLength(1);
    expect(out.externalSplits[0]).toMatchObject({
      recipientId: "rec-pix-1",
      pixAddressKey: "12345678901",
      percentualValue: 30,
    });
  });

  it("mistura wallet + PIX corretamente", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      customSplits: [
        wallet(CORRETORA, 40),
        pix("rec-pix-1", "vendedor@email.com", 30),
        wallet(VENDEDOR, 20),
      ],
      platformFeePercent: 5,
      platformWalletId: PLATFORM_WALLET,
    });
    expect(out.asaasSplits).toHaveLength(3); // CORRETORA, VENDEDOR, PLATFORM
    expect(out.externalSplits).toHaveLength(1);
    expect(out.externalSplits[0].recipientId).toBe("rec-pix-1");
  });

  it("soma de 100% considera asaas + pix + platform fee", () => {
    function expectThrow(fn: () => unknown, code: string) {
      try {
        fn();
      } catch (err) {
        expect((err as CommissionBuildError).code).toBe(code);
        return;
      }
      throw new Error("Esperava exceção");
    }
    expectThrow(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [
            wallet(CORRETORA, 50),
            pix("rec-pix-1", "12345678901", 50),
          ],
          platformFeePercent: 10,
          platformWalletId: PLATFORM_WALLET,
        }),
      "SPLIT_PERCENT_OVERFLOW"
    );
  });

  it("rejeita recipientId duplicado entre wallet e pix", () => {
    function expectThrow(fn: () => unknown, code: string) {
      try {
        fn();
      } catch (err) {
        expect((err as CommissionBuildError).code).toBe(code);
        return;
      }
      throw new Error("Esperava exceção");
    }
    expectThrow(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [
            {
              recipientType: "asaas_wallet",
              recipientId: "shared-id",
              walletId: CORRETORA,
              percentualValue: 30,
            },
            {
              recipientType: "pix_external",
              recipientId: "shared-id",
              pixAddressKey: "12345678901",
              pixKeyType: "CPF",
              ownerName: "X",
              ownerCpfCnpj: "12345678901",
              percentualValue: 30,
            },
          ],
        }),
      "SPLIT_DUPLICATE_RECIPIENT"
    );
  });

  it("PIX externos NÃO contam para o limite de 10 splits Asaas", () => {
    const tenWallets: SplitInputEntry[] = Array.from({ length: 10 }, (_, i) =>
      wallet(`wallet-${i}`, 5)
    );
    const fivePix: SplitInputEntry[] = Array.from({ length: 5 }, (_, i) =>
      pix(`pix-${i}`, `key-${i}`, 5)
    );
    expect(() =>
      composeSplits({
        orgWalletId: ORG_WALLET,
        customSplits: [...tenWallets, ...fivePix],
      })
    ).not.toThrow();
  });

  it("preserva campos completos do PIX em externalSplits", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      customSplits: [pix("rec-pix-1", "12345678901", 25)],
    });
    expect(out.externalSplits[0]).toMatchObject({
      recipientId: "rec-pix-1",
      pixAddressKey: "12345678901",
      pixKeyType: "CPF",
      ownerName: "Test Owner",
      ownerCpfCnpj: "12345678901",
      percentualValue: 25,
    });
  });
});

describe("computeAmount — valor efetivo do PIX externo (splitDispatcher)", () => {
  it("percentual aplica sobre a base (líquido), não sobre o bruto", () => {
    // base líquida 980 (bruto 1000 − ~2% taxa). 30% => 294, não 300 (=30% do bruto).
    expect(computeAmount(980, extPix(30), 0)).toBe(294);
  });

  it("fixo + percentual somam; arredonda a 2 casas", () => {
    // 10% de 333.33 = 33.333 + fixo 5 = 38.333 → 38.33
    expect(computeAmount(333.33, extPix(10, 5), 0)).toBe(38.33);
  });

  it("feeAdjustment (deduct_from_recipient) é subtraído do repasse", () => {
    expect(computeAmount(1000, extPix(50), 1)).toBe(499); // 500 − R$1 de taxa
  });

  it("clampa em 0 quando a taxa excede o valor (nunca transfere negativo)", () => {
    expect(computeAmount(100, extPix(undefined, 0.5), 1)).toBe(0);
  });

  it("soma de repasses arredondados por entry pode divergir do total em centavos", () => {
    // 3 splits de 33.333% sobre 100 → cada 33.33; soma 99.99 ≠ 100 (drift por design).
    const base = 100;
    const parts = [
      computeAmount(base, extPix(100 / 3), 0),
      computeAmount(base, extPix(100 / 3), 0),
      computeAmount(base, extPix(100 / 3), 0),
    ];
    const sum = parts.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(99.99, 2);
    expect(sum).toBeLessThanOrEqual(base); // invariante: nunca repassa mais que a base
  });
});
