import { describe, expect, it } from "vitest";
import { deriveLocacaoDealMetadata } from "../derive-deal-metadata";

const OPTS = { fallbackTitle: "Negócio - abc123" };

describe("deriveLocacaoDealMetadata", () => {
  it("par locador → locatário tem prioridade", () => {
    const { title } = deriveLocacaoDealMetadata(
      {
        locadores: [{ nome: "João Locador" }],
        locatarios: [{ nome: "Maria Locatária" }],
      },
      OPTS
    );
    expect(title).toBe("João Locador → Maria Locatária");
  });

  it("PJ usa razao_social", () => {
    const { title } = deriveLocacaoDealMetadata(
      {
        locadores: [{ razao_social: "Imóveis Alfa Ltda" }],
        locatarios: [{ razao_social: "Padaria Beta ME" }],
      },
      OPTS
    );
    expect(title).toBe("Imóveis Alfa Ltda → Padaria Beta ME");
  });

  it("só locatário → 'Locação para X'", () => {
    const { title } = deriveLocacaoDealMetadata(
      { locatarios: [{ nome: "Maria" }] },
      OPTS
    );
    expect(title).toBe("Locação para Maria");
  });

  it("só imóvel (objeto singular) → endereço", () => {
    const { title } = deriveLocacaoDealMetadata(
      { imovel: { rua: "Rua das Flores", numero: "100" } },
      OPTS
    );
    expect(title).toBe("Imóvel: Rua das Flores, 100");
  });

  it("dataJson vazio → fallbackTitle", () => {
    const { title, value } = deriveLocacaoDealMetadata({}, OPTS);
    expect(title).toBe(OPTS.fallbackTitle);
    expect(value).toBeNull();
  });

  it("formTitle vence tudo", () => {
    const { title } = deriveLocacaoDealMetadata(
      { locatarios: [{ nome: "Maria" }] },
      { ...OPTS, formTitle: "Apto 42 — Centro" }
    );
    expect(title).toBe("Apto 42 — Centro");
  });

  it("value vem de aluguel.valor; 0/ausente vira null", () => {
    expect(
      deriveLocacaoDealMetadata({ aluguel: { valor: 2500 } }, OPTS).value
    ).toBe(2500);
    expect(
      deriveLocacaoDealMetadata({ aluguel: { valor: 0 } }, OPTS).value
    ).toBeNull();
    expect(deriveLocacaoDealMetadata({}, OPTS).value).toBeNull();
  });
});
