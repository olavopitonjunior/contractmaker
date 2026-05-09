import { describe, it, expect } from "vitest";
import {
  validatePayer,
  validateCharge,
  validateSplits,
} from "../charge-validators";
import type { SplitInputEntry } from "../commission";

const ORG_WALLET = "org-wallet-uuid";

describe("validatePayer", () => {
  it("ok quando nome e CPF preenchidos", () => {
    const r = validatePayer({ nome: "João Silva", cpfCnpj: "12345678901" });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("erro quando nome ausente", () => {
    const r = validatePayer({ cpfCnpj: "12345678901" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Nome/i);
  });

  it("erro quando CPF inválido (menos de 11 dígitos)", () => {
    const r = validatePayer({ nome: "X", cpfCnpj: "123" });
    expect(r.ok).toBe(false);
    // Erros tanto pra nome curto quanto CPF inválido
    expect(r.errors.some((e) => /CPF/i.test(e))).toBe(true);
  });

  it("aceita CPF com máscara (extrai dígitos)", () => {
    const r = validatePayer({ nome: "João", cpfCnpj: "123.456.789-01" });
    expect(r.ok).toBe(true);
  });

  it("aceita CNPJ (14 dígitos)", () => {
    const r = validatePayer({ nome: "Empresa X", cpfCnpj: "12345678000100" });
    expect(r.ok).toBe(true);
  });

  it("warning quando PIX sem email", () => {
    const r = validatePayer({
      nome: "João",
      cpfCnpj: "12345678901",
      billingType: "PIX",
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /email/i.test(w))).toBe(true);
  });

  it("sem warning quando Boleto sem email", () => {
    const r = validatePayer({
      nome: "João",
      cpfCnpj: "12345678901",
      billingType: "BOLETO",
    });
    expect(r.warnings).toEqual([]);
  });
});

describe("validateCharge", () => {
  function tomorrow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  it("ok quando valor positivo + data futura + billingType", () => {
    const r = validateCharge({
      value: 15000,
      dueDate: tomorrow(),
      billingType: "PIX",
    });
    expect(r.ok).toBe(true);
  });

  it("erro quando valor zero", () => {
    const r = validateCharge({
      value: 0,
      dueDate: tomorrow(),
      billingType: "PIX",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /positiv/i.test(e))).toBe(true);
  });

  it("erro quando data no passado", () => {
    const r = validateCharge({
      value: 100,
      dueDate: "2020-01-01",
      billingType: "PIX",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /passado/i.test(e))).toBe(true);
  });

  it("erro quando data formato inválido", () => {
    const r = validateCharge({
      value: 100,
      dueDate: "01/01/2026",
      billingType: "PIX",
    });
    expect(r.ok).toBe(false);
  });

  it("erro quando billingType ausente", () => {
    const r = validateCharge({ value: 100, dueDate: tomorrow() });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /pagamento/i.test(e))).toBe(true);
  });
});

describe("validateSplits", () => {
  it("warning quando customSplits vazios (todo cai na org)", () => {
    const r = validateSplits({ orgWalletId: ORG_WALLET });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /subconta/i.test(w))).toBe(true);
  });

  it("ok com 1 split asaas_wallet válido", () => {
    const splits: SplitInputEntry[] = [
      {
        recipientType: "asaas_wallet",
        walletId: "wallet-x",
        percentualValue: 50,
      },
    ];
    const r = validateSplits({ customSplits: splits, orgWalletId: ORG_WALLET });
    expect(r.ok).toBe(true);
  });

  it("erro quando soma > 100", () => {
    const splits: SplitInputEntry[] = [
      {
        recipientType: "asaas_wallet",
        walletId: "w1",
        percentualValue: 60,
      },
      {
        recipientType: "asaas_wallet",
        walletId: "w2",
        percentualValue: 50,
      },
    ];
    const r = validateSplits({ customSplits: splits, orgWalletId: ORG_WALLET });
    expect(r.ok).toBe(false);
  });

  it("erro quando wallet duplicado", () => {
    const splits: SplitInputEntry[] = [
      {
        recipientType: "asaas_wallet",
        walletId: "wDup",
        percentualValue: 30,
      },
      {
        recipientType: "asaas_wallet",
        walletId: "wDup",
        percentualValue: 20,
      },
    ];
    const r = validateSplits({ customSplits: splits, orgWalletId: ORG_WALLET });
    expect(r.ok).toBe(false);
  });

  it("erro quando wallet é da própria org", () => {
    const splits: SplitInputEntry[] = [
      {
        recipientType: "asaas_wallet",
        walletId: ORG_WALLET,
        percentualValue: 10,
      },
    ];
    const r = validateSplits({ customSplits: splits, orgWalletId: ORG_WALLET });
    expect(r.ok).toBe(false);
  });

  it("erro quando display.consolidationMap aponta pra split não-visível", () => {
    const splits: SplitInputEntry[] = [
      {
        recipientType: "asaas_wallet",
        walletId: "w-visible",
        recipientId: "r-vis",
        percentualValue: 50,
      },
      {
        recipientType: "asaas_wallet",
        walletId: "w-hidden",
        recipientId: "r-hid",
        percentualValue: 30,
      },
    ];
    const r = validateSplits({
      customSplits: splits,
      orgWalletId: ORG_WALLET,
      display: {
        hiddenRecipientIds: ["r-hid"],
        consolidationMap: { "r-hid": "r-nonexistent" },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/n[ãa]o.*vis[íi]vel/i);
  });

  it("warning quando todos os splits estão ocultos", () => {
    const splits: SplitInputEntry[] = [
      {
        recipientType: "asaas_wallet",
        walletId: "w1",
        recipientId: "r1",
        percentualValue: 100,
      },
    ];
    const r = validateSplits({
      customSplits: splits,
      orgWalletId: ORG_WALLET,
      display: {
        hiddenRecipientIds: ["r1"],
        consolidationMap: {},
      },
    });
    expect(r.ok).toBe(true); // warning, não erro
    expect(r.warnings.some((w) => /ocultos/i.test(w))).toBe(true);
  });
});
