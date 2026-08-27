import { describe, it, expect } from "vitest";
import {
  expectedFieldsFor,
  calcularCobertura,
  CATEGORIAS_SEM_GUIA,
} from "../expected-fields";
import type { Assignment } from "../extracted-to-form";

const vendedor1: Assignment = { kind: "vendedor", index: 0 };
const comprador2: Assignment = { kind: "comprador", index: 1 };
const conjuge: Assignment = { kind: "conjuge_vendedor", index: 0 };
const imovel1: Assignment = { kind: "imovel", index: 0 };

const nomes = (a: Assignment | null, c: string | null) =>
  expectedFieldsFor(a, c).campos.map((x) => x.campo);

describe("expectedFieldsFor — a interseção", () => {
  /**
   * O caso que dá nome à ideia: pedir a lista INTEIRA do Vendedor para um RG é
   * o que derrubou a extração de CNH de 11 campos para 3 neste projeto.
   */
  it("RG para Vendedor 1 pede identidade, e NÃO pede o que não está num RG", () => {
    const campos = nomes(vendedor1, "rg");

    expect(campos).toContain("nome");
    expect(campos).toContain("rg");
    expect(campos).toContain("cpf");
    expect(campos).toContain("data_nascimento");
    expect(campos).toContain("nome_mae");

    // Um RG não tem nada disso — e pedir empurra o modelo a inventar.
    expect(campos).not.toContain("profissao");
    expect(campos).not.toContain("email");
    expect(campos).not.toContain("mobile_phone");
    expect(campos).not.toContain("cep");
  });

  it("matrícula para Imóvel 1 pede matrícula e cartório, não dados de pessoa", () => {
    const campos = nomes(imovel1, "matricula");

    expect(campos).toContain("matricula");
    expect(campos).toContain("cartorio");
    expect(campos).toContain("descricao");

    expect(campos).not.toContain("cpf");
    expect(campos).not.toContain("data_nascimento");
    // Matrícula não tem CEP — 16 de 17 medidos em produção.
    expect(campos).not.toContain("cep");
  });

  /**
   * O mesmo documento muda de vocabulário conforme o destino: pessoa usa
   * `endereco`, imóvel usa `rua`. A interseção escolhe sozinha.
   */
  it("comprovante de residência muda de campo conforme o destino", () => {
    const paraPessoa = nomes(vendedor1, "comprovante_residencia");
    const paraImovel = nomes(imovel1, "comprovante_residencia");

    expect(paraPessoa).toContain("endereco");
    expect(paraPessoa).not.toContain("rua");

    expect(paraImovel).toContain("rua");
    expect(paraImovel).not.toContain("endereco");
  });

  it("sub-parte aceita menos campos que o titular", () => {
    const doTitular = nomes(vendedor1, "rg");
    const doConjuge = nomes(conjuge, "rg");

    expect(doTitular).toContain("estado_civil");
    // Cônjuge não tem estado_civil próprio no formulário.
    expect(doConjuge).not.toContain("estado_civil");
    expect(doConjuge).toContain("nome");
    expect(doConjuge).toContain("cpf");
  });

  it("o índice do destino entra no basePath", () => {
    expect(expectedFieldsFor(comprador2, "rg").basePath).toBe("compradores.1");
    expect(expectedFieldsFor(vendedor1, "rg").basePath).toBe("vendedores.0");
  });

  it("cada campo vem com rótulo humano para virar descrição no schema", () => {
    const campos = expectedFieldsFor(vendedor1, "rg").campos;
    const cpf = campos.find((c) => c.campo === "cpf");
    expect(cpf?.rotulo).toBeTruthy();
    expect(cpf?.rotulo).not.toBe("");
  });
});

describe("expectedFieldsFor — quando NÃO guiar", () => {
  /**
   * Degradar para o caminho de sempre é a resposta certa. Guiar no escuro
   * produziria schema errado, que é pior que schema nenhum.
   */
  it("sem destino escolhido, não guia", () => {
    expect(expectedFieldsFor(null, "rg").guiado).toBe(false);
  });

  it("sem categoria, não guia", () => {
    expect(expectedFieldsFor(vendedor1, null).guiado).toBe(false);
  });

  it("destino 'outro' não guia", () => {
    expect(expectedFieldsFor({ kind: "outro", index: 0 }, "rg").guiado).toBe(false);
  });

  /**
   * `outro` e `ficha_resumo` rendem MAIS em formato livre — a ficha entrega 22
   * campos sem schema contra 7 com schema. Guiar aqui pioraria.
   */
  it("categorias que rendem mais livres ficam de fora", () => {
    for (const cat of CATEGORIAS_SEM_GUIA) {
      expect(expectedFieldsFor(vendedor1, cat).guiado).toBe(false);
    }
  });

  it("categoria desconhecida não guia", () => {
    expect(expectedFieldsFor(vendedor1, "boleto_de_condominio").guiado).toBe(false);
  });

  /**
   * Interseção vazia não é erro — um comprovante de residência mandado para um
   * procurador não tem o que oferecer. Mas schema vazio quebraria, então
   * degrada.
   */
  it("interseção vazia degrada em vez de produzir schema vazio", () => {
    const r = expectedFieldsFor({ kind: "procurador_vendedor", index: 0 }, "iptu");
    expect(r.guiado).toBe(false);
    expect(r.campos).toEqual([]);
  });
});

describe("calcularCobertura", () => {
  const esperados = [
    { campo: "nome", rotulo: "Nome" },
    { campo: "cpf", rotulo: "CPF" },
    { campo: "rg", rotulo: "RG" },
  ];

  it("conta o que veio e nomeia o que faltou", () => {
    const c = calcularCobertura(esperados, { nome: "Joao", cpf: "52998224725" });
    expect(c.esperados).toBe(3);
    expect(c.preenchidos).toBe(2);
    expect(c.faltantes).toEqual(["rg"]);
  });

  /**
   * As mesmas sentinelas que a ponte para o formulário já descarta. Sem isto,
   * a cobertura contaria "null" como campo preenchido e mentiria para cima —
   * exatamente o defeito do "% de confiança" que este número substitui.
   */
  it("sentinela de ausência não conta como preenchido", () => {
    const c = calcularCobertura(esperados, {
      nome: "null",
      cpf: "   ",
      rg: "N/A",
    });
    expect(c.preenchidos).toBe(0);
    expect(c.faltantes).toEqual(["nome", "cpf", "rg"]);
  });

  it("cobertura cheia não deixa faltante", () => {
    const c = calcularCobertura(esperados, { nome: "A", cpf: "B", rg: "C" });
    expect(c.preenchidos).toBe(3);
    expect(c.faltantes).toEqual([]);
  });
});
