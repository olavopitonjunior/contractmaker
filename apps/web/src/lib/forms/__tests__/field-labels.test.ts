import { describe, it, expect } from "vitest";
import {
  describeFormPath,
  describeMissingPaths,
  VENDA_FIELD_CATALOG,
  LOCACAO_FIELD_CATALOG,
} from "@/lib/forms/field-labels";

/**
 * O toast de pendências é a ÚNICA pista que o cliente tem do que falta — o
 * formulário público não tem lista de erros nem sumário. Um rótulo errado aqui
 * manda a pessoa procurar o campo errado.
 */
describe("describeFormPath", () => {
  it("parte com índice 0 não repete o número (há uma só)", () => {
    expect(describeFormPath("vendedores.0.cpf")).toBe("Vendedor — CPF");
    expect(describeFormPath("compradores.0.email")).toBe("Comprador — E-mail");
  });

  it("parte com índice > 0 numera a partir de 2", () => {
    expect(describeFormPath("vendedores.1.cpf")).toBe("Vendedor 2 — CPF");
    expect(describeFormPath("locatarios.2.mobile_phone")).toBe("Locatário 3 — Celular");
  });

  it("vocabulário de locação sai correto", () => {
    expect(describeFormPath("locadores.0.nome")).toBe("Locador — Nome");
  });

  it("campo aninhado usa o último segmento", () => {
    expect(describeFormPath("vendedores.0.conjuge.nome")).toBe("Vendedor — Nome");
  });

  it("path fora de lista cai no mapa direto", () => {
    expect(describeFormPath("pagamento.sinal_arras")).toBe("Sinal/Arras");
    expect(describeFormPath("modalidade")).toBe("Modalidade");
    expect(describeFormPath("imovel.matricula")).toBe("Matrícula");
  });

  it("campo desconhecido é humanizado em vez de vazar o path cru", () => {
    expect(describeFormPath("algum.campo_novo_qualquer")).toBe("Campo novo qualquer");
  });
});

describe("describeMissingPaths", () => {
  it("nomeia até 4 e resume o resto", () => {
    const paths = [
      "vendedores.0.cpf",
      "vendedores.0.email",
      "compradores.0.cpf",
      "imoveis.0.matricula",
      "imoveis.0.cartorio",
      "modalidade",
    ];
    expect(describeMissingPaths(paths)).toBe(
      "Vendedor — CPF, Vendedor — E-mail, Comprador — CPF, Imóvel — Matrícula e mais 2"
    );
  });

  it("sem excedente não acrescenta sufixo", () => {
    expect(describeMissingPaths(["modalidade"])).toBe("Modalidade");
  });
});

describe("catálogos (fonte única com a tela de configuração)", () => {
  it("todo path do catálogo tem rótulo próprio — nenhum cai no fallback cru", () => {
    const todos = [...VENDA_FIELD_CATALOG, ...LOCACAO_FIELD_CATALOG].flatMap(
      (g) => g.paths
    );
    expect(todos.length).toBeGreaterThan(0);
    for (const { path } of todos) {
      // O fallback humanizado nunca contém ponto; um path cru vazando contém.
      expect(describeFormPath(path)).not.toContain(".");
    }
  });
});
