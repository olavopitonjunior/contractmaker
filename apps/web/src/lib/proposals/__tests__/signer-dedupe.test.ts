import { describe, it, expect } from "vitest";
import {
  computeDedupeKey,
  dedupeSigners,
  SignerCollisionError,
} from "../signer-dedupe";

describe("computeDedupeKey — chave canônica de identidade", () => {
  it("CPF tem prioridade e ignora máscara", () => {
    expect(computeDedupeKey({ name: "X", cpf: "123.456.789-00" })).toBe(
      "cpf:12345678900"
    );
  });
  it("mesma pessoa com máscaras diferentes → mesma chave", () => {
    expect(computeDedupeKey({ name: "A", cpf: "12345678900" })).toBe(
      computeDedupeKey({ name: "B", cpf: "123.456.789-00" })
    );
  });
  it("sem CPF cai no e-mail (case-insensitive)", () => {
    expect(computeDedupeKey({ name: "X", email: "Casal@X.com" })).toBe(
      "email:casal@x.com"
    );
  });
  it("sem CPF nem e-mail cai no nome normalizado + telefone", () => {
    expect(
      computeDedupeKey({ name: "José da Conceição", phone: "11987654321" })
    ).toBe("name:jose da conceicao|+5511987654321");
  });
});

describe("dedupeSigners — a regra 'sem duplicidade'", () => {
  it("mesmo CPF no MESMO grupo → 1 signatário, papéis fundidos", () => {
    const out = dedupeSigners([
      { role: "vendedor", name: "José Silva", cpf: "12345678900", signingGroup: 2 },
      { role: "procurador", name: "José Silva", cpf: "12345678900", signingGroup: 2 },
    ]);
    expect(out.signers).toHaveLength(1);
    expect(out.merged[0].roles).toEqual(["vendedor", "procurador"]);
  });

  it("preenche contatos faltantes ao fundir", () => {
    const out = dedupeSigners([
      { role: "vendedor", name: "José", cpf: "12345678900", email: null, signingGroup: 2 },
      { role: "procurador", name: "José", cpf: "12345678900", email: "j@x.com", signingGroup: 2 },
    ]);
    expect(out.signers[0].email).toBe("j@x.com");
  });

  it("mesmo CPF em GRUPOS diferentes → erro duro (não assina 2x em ordens diferentes)", () => {
    expect(() =>
      dedupeSigners([
        { role: "proponente", name: "João", cpf: "12345678900", signingGroup: 1 },
        { role: "vendedor", name: "João", cpf: "12345678900", signingGroup: 2 },
      ])
    ).toThrow(SignerCollisionError);
  });

  it("pessoas distintas ficam separadas", () => {
    const out = dedupeSigners([
      { role: "proponente", name: "Marcia", cpf: "11144477735", signingGroup: 1 },
      { role: "vendedor", name: "José", cpf: "12345678900", signingGroup: 2 },
    ]);
    expect(out.signers).toHaveLength(2);
    expect(out.merged).toHaveLength(0);
  });
});
