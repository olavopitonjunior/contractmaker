import { describe, it, expect } from "vitest";
import {
  checkSignerReadiness,
  checkProposalReadiness,
  toE164BR,
} from "../clicksign-readiness";

describe("toE164BR — normaliza telefone com DDI", () => {
  it("11 dígitos (celular) → +55...", () => {
    expect(toE164BR("11987654321")).toBe("+5511987654321");
  });
  it("10 dígitos (fixo) → +55...", () => {
    expect(toE164BR("1132654321")).toBe("+551132654321");
  });
  it("já com máscara e DDI preserva o 55", () => {
    expect(toE164BR("+55 (11) 98765-4321")).toBe("+5511987654321");
  });
  it("lixo → null", () => {
    expect(toE164BR("123")).toBeNull();
    expect(toE164BR("")).toBeNull();
    expect(toE164BR(null)).toBeNull();
  });
});

describe("checkSignerReadiness — o preflight que evita 422 no envio", () => {
  it("nome de UMA palavra é barrado (o furo do plano)", () => {
    const issues = checkSignerReadiness(
      { name: "Marcia", email: "m@x.com" },
      0
    );
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("nome completo + e-mail válido → sem pendência", () => {
    const issues = checkSignerReadiness(
      { name: "Marcia Souza", email: "marcia@gmail.com" },
      0
    );
    expect(issues).toHaveLength(0);
  });

  it("CPF inválido é barrado; ausente é permitido", () => {
    expect(
      checkSignerReadiness(
        { name: "Marcia Souza", email: "m@x.com", cpf: "11111111111" },
        0
      ).some((i) => i.field === "cpf")
    ).toBe(true);
    expect(
      checkSignerReadiness(
        { name: "Marcia Souza", email: "m@x.com" },
        0
      ).some((i) => i.field === "cpf")
    ).toBe(false);
  });

  it("canal WhatsApp exige telefone válido", () => {
    const semTel = checkSignerReadiness(
      { name: "Marcia Souza", notifyChannel: "whatsapp" },
      0
    );
    expect(semTel.some((i) => i.field === "phone")).toBe(true);

    const comTel = checkSignerReadiness(
      { name: "Marcia Souza", notifyChannel: "whatsapp", phone: "11987654321" },
      0
    );
    expect(comTel.some((i) => i.field === "phone")).toBe(false);
  });

  it("canal WhatsApp NÃO exige e-mail (o caso do proprietário)", () => {
    const issues = checkSignerReadiness(
      { name: "José Silva", notifyChannel: "whatsapp", phone: "11987654321" },
      0
    );
    expect(issues).toHaveLength(0);
  });

  it("canal e-mail sem e-mail é barrado", () => {
    const issues = checkSignerReadiness(
      { name: "Marcia Souza", notifyChannel: "email" },
      0
    );
    expect(issues.some((i) => i.field === "email")).toBe(true);
  });

  it("typo de domínio vira hint, não erro fatal", () => {
    const issues = checkSignerReadiness(
      { name: "Marcia Souza", email: "marcia@gmial.com" },
      0
    );
    const emailIssue = issues.find((i) => i.field === "email");
    expect(emailIssue?.hint).toBe("marcia@gmail.com");
  });

  it("checkProposalReadiness agrega por índice", () => {
    const all = checkProposalReadiness([
      { name: "Marcia Souza", email: "marcia@gmail.com" }, // ok
      { name: "Zé", notifyChannel: "whatsapp" }, // nome curto + sem telefone
    ]);
    expect(all.every((i) => i.signerIndex === 1)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
