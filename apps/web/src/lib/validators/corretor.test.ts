import { describe, it, expect } from "vitest";
import {
  isValidCpfCnpj,
  isValidCreci,
  normalizeEmail,
  normalizePhoneForStorage,
} from "./corretor";

describe("normalizePhoneForStorage", () => {
  it("grava E.164 (+55…) — formato que Max/notify comparam na leitura", () => {
    expect(normalizePhoneForStorage("(11) 98765-4321").value).toBe("+5511987654321");
    expect(normalizePhoneForStorage("11987654321").value).toBe("+5511987654321");
    expect(normalizePhoneForStorage("5511987654321").value).toBe("+5511987654321");
    expect(normalizePhoneForStorage("+55 11 98765-4321").value).toBe("+5511987654321");
    // fixo 10 dígitos
    expect(normalizePhoneForStorage("(11) 3456-7890").value).toBe("+551134567890");
  });

  it("vazio → null sem flag de inválido", () => {
    expect(normalizePhoneForStorage("")).toEqual({ value: null, invalid: false });
    expect(normalizePhoneForStorage(null)).toEqual({ value: null, invalid: false });
    expect(normalizePhoneForStorage(undefined)).toEqual({ value: null, invalid: false });
  });

  it("não-parseável: strict → invalid; soft (form anônimo) → mantém cru", () => {
    expect(normalizePhoneForStorage("123")).toEqual({ value: null, invalid: true });
    expect(normalizePhoneForStorage("123", { soft: true })).toEqual({
      value: "123",
      invalid: false,
    });
  });
});

describe("normalizeEmail", () => {
  it("trim + lowercase; vazio → null", () => {
    expect(normalizeEmail("  Joao.Silva@Gmail.COM ")).toBe("joao.silva@gmail.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("isValidCreci", () => {
  it("aceita formatos comuns", () => {
    for (const v of ["12345", "12345-F", "12345F", "SP-12345", "CRECI/SP 12345-J", "creci sp 12345"]) {
      expect(isValidCreci(v), v).toBe(true);
    }
  });
  it("rejeita lixo", () => {
    for (const v of ["", "abc", "12345678901", "12-34-56-XYZ"]) {
      expect(isValidCreci(v), v).toBe(false);
    }
  });
});

describe("isValidCpfCnpj (reexport)", () => {
  it("valida dígito verificador", () => {
    expect(isValidCpfCnpj("390.533.447-05")).toBe(true); // CPF válido clássico
    expect(isValidCpfCnpj("390.533.447-06")).toBe(false);
    expect(isValidCpfCnpj("11.222.333/0001-81")).toBe(true); // CNPJ válido
    expect(isValidCpfCnpj("11.222.333/0001-82")).toBe(false);
  });
});
