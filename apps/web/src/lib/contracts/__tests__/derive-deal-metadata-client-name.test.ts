import { describe, expect, it } from "vitest";
import {
  deriveDealMetadata,
  deriveLocacaoDealMetadata,
} from "../derive-deal-metadata";

const OPTS = { fallbackTitle: "Negócio - abc123" };

// clientName denormalizado (Deal.clientName) — o kanban lê a coluna em vez de
// carregar form.dataJson inteiro por deal.
describe("clientName derivado", () => {
  it("venda: comprador PF titular", () => {
    const { clientName } = deriveDealMetadata(
      { compradores: [{ nome: "  Ana Compradora  " }] },
      OPTS
    );
    expect(clientName).toBe("Ana Compradora");
  });

  it("venda: PJ usa razao_social", () => {
    const { clientName } = deriveDealMetadata(
      { compradores: [{ razao_social: "Construtora Gama Ltda" }] },
      OPTS
    );
    expect(clientName).toBe("Construtora Gama Ltda");
  });

  it("venda: sem comprador → null (não string vazia)", () => {
    const { clientName } = deriveDealMetadata({ vendedores: [{ nome: "V" }] }, OPTS);
    expect(clientName).toBeNull();
  });

  it("venda: nome vazio/whitespace → null", () => {
    const { clientName } = deriveDealMetadata(
      { compradores: [{ nome: "   " }] },
      OPTS
    );
    expect(clientName).toBeNull();
  });

  it("locação: locatário titular", () => {
    const { clientName } = deriveLocacaoDealMetadata(
      { locatarios: [{ nome: "Maria Locatária" }] },
      OPTS
    );
    expect(clientName).toBe("Maria Locatária");
  });

  it("locação: sem locatário → null", () => {
    const { clientName } = deriveLocacaoDealMetadata(
      { locadores: [{ nome: "João" }] },
      OPTS
    );
    expect(clientName).toBeNull();
  });
});
