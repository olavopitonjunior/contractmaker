import { describe, it, expect } from "vitest";
import { INJECTION_KINDS, inject } from "../eval/semantic-inject";
import { runSemanticChecks } from "../semantic-checks";
import { splitDocParagraphs } from "../insertion-report";

/**
 * As injeções são o gabarito da bateria de recall: se uma delas não reproduz
 * o defeito registrado na conferência da Trio, a bateria mede outra coisa. O
 * que se guarda aqui: cada injeção produz o texto certo no lugar certo, e o
 * "n/a" só aparece quando o texto não tem a cláusula.
 */
const ORG = {
  legalName: "Imobiliária Exemplo Ltda",
  cnpj: "11.610.282/0001-65",
  creci: "24.342-J",
  pixAddressKey: "financeiro@exemplo.test",
  bankBranch: "3971-6",
  bankAccount: "58204-3",
};

const SOURCE = [
  "4.1. Os valores do aluguel serão pagos até o dia 20 de cada mês.",
  "4.2. O pagamento correspondente ao primeiro aluguel será fracionado aos intermediadores, da seguinte forma:",
  "a) R$ 3.569,71 (três mil reais), a ser pago diretamente à imobiliária intermediadora Atrio Ltda, CNPJ 64.524.938/0001-93, por meio da conta 96637;",
  "b) R$ 1.315,15 (mil reais), a ser pago diretamente à corretora intermediadora Neide Alves, via PIX 087.438.055-77;",
  "c) R$ 1.315,15 (mil reais), a ser pago diretamente ao corretor intermediador Carlos Natrielli, conta 682331986-6, inscrito no CRECI sob o nº79.434.",
  "4.2.2. A comprovação do pagamento dos valores estipulados no item 4.2. servirá como quitação integral.",
  "4.3. Na eventualidade de atraso, multa de 10%.",
].join("\n");

/** O que o planejador produz hoje: a lista inteira numa chave composta. */
const CLEAN = [
  "4.1. Os valores do aluguel serão pagos até o dia 20 de cada mês.",
  "4.2. O pagamento correspondente ao primeiro aluguel será fracionado aos intermediadores, da seguinte forma:",
  "{{rateio_primeiro_aluguel}}",
  "4.2.2. A comprovação do pagamento dos valores estipulados no item 4.2. servirá como quitação integral.",
  "4.3. Na eventualidade de atraso, multa de 10%.",
].join("\n");

describe("semantic-inject — cada injeção reproduz o defeito registrado", () => {
  it("wrong-entity: item a) com as chaves do corretor, no lugar da chave composta", () => {
    const inj = inject("wrong-entity", CLEAN, SOURCE, ORG)!;
    const paras = splitDocParagraphs(inj.text);
    expect(inj.paragraphIndex).toBe(2);
    expect(paras[2]).toMatch(/^a\) R\$ 3\.569,71 \(três mil reais\), a ser pago diretamente à imobiliária intermediadora \{\{corretagem_qualificacao\}\}/);
    expect(paras[3]).toMatch(/^b\) R\$ 1\.315,15/);
    expect(paras[4]).toMatch(/^c\) /);
    expect(paras[5]).toMatch(/^4\.2\.2\./);
    expect(inj.expect).toBe("wrong-entity");
  });

  it("leftover-creci: o CRECI real literal depois da chave do corretor no item c)", () => {
    const inj = inject("leftover-creci", CLEAN, SOURCE, ORG)!;
    const paras = splitDocParagraphs(inj.text);
    expect(inj.paragraphIndex).toBe(4);
    expect(paras[4]).toMatch(/\{\{corretagem_dados_pagamento\}\} inscrito no CRECI sob o nº79\.434\.$/);
    expect(paras[2]).toContain("{{imobiliaria_qualificacao}}");
  });

  it("leftover-endereco: o endereço da imobiliária literal depois da chave no item a)", () => {
    const inj = inject("leftover-endereco", CLEAN, SOURCE, ORG)!;
    expect(splitDocParagraphs(inj.text)[2]).toContain(
      "{{imobiliaria_qualificacao}}, com sede na Rua Ribeiro do Vale, nº 514, Brooklin, CEP 04568-001"
    );
  });

  it("org-literal: o cadastro da própria imobiliária fixo no item a)", () => {
    const inj = inject("org-literal", CLEAN, SOURCE, ORG)!;
    expect(splitDocParagraphs(inj.text)[2]).toContain("CNPJ sob nº 11.610.282/0001-65");
    expect(inj.expect).toBe("org-literal");
  });

  it("collapsed-list: cabeçalho + lista viram uma chave de dado solta", () => {
    const inj = inject("collapsed-list", CLEAN, SOURCE, ORG)!;
    const paras = splitDocParagraphs(inj.text);
    expect(paras).toEqual([
      "4.1. Os valores do aluguel serão pagos até o dia 20 de cada mês.",
      "{{corretagem_dados_pagamento}}",
      "4.2.2. A comprovação do pagamento dos valores estipulados no item 4.2. servirá como quitação integral.",
      "4.3. Na eventualidade de atraso, multa de 10%.",
    ]);
    expect(inj.paragraphIndex).toBe(1);
  });

  it("dangling-only: só o cabeçalho some e a citação fica; sem citação → n/a", () => {
    const inj = inject("dangling-only", CLEAN, SOURCE, ORG)!;
    const paras = splitDocParagraphs(inj.text);
    expect(paras[1]).toBe("{{rateio_primeiro_aluguel}}");
    expect(paras[inj.paragraphIndex]).toMatch(/item 4\.2\./);
    const semCitacao = CLEAN.replace("no item 4.2. ", "");
    expect(inject("dangling-only", semCitacao, SOURCE, ORG)).toBeNull();
  });

  it("lista ainda item a item (antes do R8) também é localizada", () => {
    const expanded = CLEAN.replace(
      "{{rateio_primeiro_aluguel}}",
      [
        "a) R$ 3.569,71, à imobiliária intermediadora {{imobiliaria_qualificacao}}, por meio {{imobiliaria_dados_pagamento}};",
        "b) R$ 1.315,15, à corretora intermediadora {{corretagem_qualificacao}}, na conta {{corretagem_dados_pagamento}};",
        "c) R$ 1.315,15, ao corretor intermediador {{corretagem_qualificacao}}, na conta {{corretagem_dados_pagamento}}.",
      ].join("\n")
    );
    const inj = inject("collapsed-list", expanded, SOURCE, ORG)!;
    expect(splitDocParagraphs(inj.text)[1]).toBe("{{corretagem_dados_pagamento}}");
    expect(splitDocParagraphs(inj.text)[2]).toMatch(/^4\.2\.2\./);
  });

  it("texto sem cláusula de rateio → n/a em todas", () => {
    for (const k of INJECTION_KINDS) {
      expect(inject(k, "1. Prazo de 30 meses.\n2. Foro de Curitiba.", SOURCE, ORG)).toBeNull();
    }
  });
});

describe("semantic-inject — as checagens veem o que foi injetado (sanidade do gabarito)", () => {
  it.each(INJECTION_KINDS)("%s é detectada no parágrafo esperado", (kind) => {
    const inj = inject(kind, CLEAN, SOURCE, ORG)!;
    const rep = runSemanticChecks({ docText: inj.text, modalidade: "locacao", org: ORG, sourceText: SOURCE });
    const hit = rep.findings.some(
      (f) => f.category === inj.expect && Math.abs(f.paragraphIndex - inj.paragraphIndex) <= 1
    );
    expect(
      hit,
      `${kind}: esperava ${inj.expect} em ¶${inj.paragraphIndex + 1}; achados: ${rep.findings
        .map((f) => `${f.category}@${f.paragraphIndex + 1}`)
        .join(", ") || "nenhum"}`
    ).toBe(true);
  });
});
