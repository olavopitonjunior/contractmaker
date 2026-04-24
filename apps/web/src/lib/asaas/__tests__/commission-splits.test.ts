import { describe, it, expect } from "vitest";
import { composeSplits, CommissionBuildError } from "../commission";

const ORG_WALLET = "org-wallet-uuid-xxx";
const PLATFORM_WALLET = "platform-wallet-uuid-yyy";
const CORRETORA = "corretora-wallet-uuid";
const VENDEDOR = "vendedor-wallet-uuid";

describe("composeSplits", () => {
  it("retorna undefined se não há split algum configurado", () => {
    const out = composeSplits({ orgWalletId: ORG_WALLET });
    expect(out).toBeUndefined();
  });

  it("retorna undefined se platform fee é 0 sem custom splits", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      platformFeePercent: 0,
      platformWalletId: PLATFORM_WALLET,
    });
    expect(out).toBeUndefined();
  });

  it("retorna undefined se platform fee > 0 mas wallet ID ausente", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      platformFeePercent: 5,
      platformWalletId: null,
    });
    expect(out).toBeUndefined();
  });

  it("gera split só da plataforma quando custom é vazio", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      platformFeePercent: 5,
      platformWalletId: PLATFORM_WALLET,
    });
    expect(out).toHaveLength(1);
    expect(out?.[0]).toEqual({
      walletId: PLATFORM_WALLET,
      percentualValue: 5,
    });
  });

  it("concatena custom splits + platform fee", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      customSplits: [
        { walletId: CORRETORA, percentualValue: 60 },
        { walletId: VENDEDOR, percentualValue: 30 },
      ],
      platformFeePercent: 5,
      platformWalletId: PLATFORM_WALLET,
    });
    expect(out).toHaveLength(3);
    expect(out?.[0].walletId).toBe(CORRETORA);
    expect(out?.[1].walletId).toBe(VENDEDOR);
    expect(out?.[2].walletId).toBe(PLATFORM_WALLET);
  });

  it("aceita soma exata de 100% (remainder zero)", () => {
    expect(() =>
      composeSplits({
        orgWalletId: ORG_WALLET,
        customSplits: [
          { walletId: CORRETORA, percentualValue: 70 },
          { walletId: VENDEDOR, percentualValue: 30 },
        ],
      })
    ).not.toThrow();
  });

  function expectSplitError(
    fn: () => unknown,
    code: string
  ): CommissionBuildError {
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
          customSplits: [
            { walletId: CORRETORA, percentualValue: 60 },
            { walletId: VENDEDOR, percentualValue: 35 },
          ],
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
          customSplits: [
            { walletId: CORRETORA, percentualValue: 50 },
            { walletId: CORRETORA, percentualValue: 20 },
          ],
        }),
      "SPLIT_DUPLICATE_WALLET"
    );
  });

  it("rejeita split para wallet da própria org", () => {
    expectSplitError(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [{ walletId: ORG_WALLET, percentualValue: 10 }],
        }),
      "SPLIT_SELF_WALLET"
    );
  });

  it("rejeita entry sem percentualValue nem fixedValue", () => {
    expectSplitError(
      () =>
        composeSplits({
          orgWalletId: ORG_WALLET,
          customSplits: [{ walletId: CORRETORA, percentualValue: 0 }],
        }),
      "SPLIT_EMPTY_VALUE"
    );
  });

  it("aceita entry com fixedValue sem percentualValue", () => {
    const out = composeSplits({
      orgWalletId: ORG_WALLET,
      customSplits: [{ walletId: CORRETORA, fixedValue: 100 }],
    });
    expect(out).toHaveLength(1);
    expect(out?.[0].fixedValue).toBe(100);
  });

  it("rejeita mais de 10 destinatários", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      walletId: `wallet-${i}`,
      percentualValue: 1,
    }));
    expectSplitError(
      () => composeSplits({ orgWalletId: ORG_WALLET, customSplits: many }),
      "SPLIT_TOO_MANY"
    );
  });

  it("exatamente 10 destinatários é OK", () => {
    const exactly = Array.from({ length: 10 }, (_, i) => ({
      walletId: `wallet-${i}`,
      percentualValue: 5,
    }));
    expect(() =>
      composeSplits({ orgWalletId: ORG_WALLET, customSplits: exactly })
    ).not.toThrow();
  });
});
