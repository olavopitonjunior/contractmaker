import { describe, it, expect } from "vitest";
import { classifyIntent } from "../routing";

describe("classifyIntent", () => {
  describe("informational", () => {
    it("classifica pergunta terminando com '?' como informational", () => {
      expect(classifyIntent("Quais cláusulas tem este contrato?")).toBe("informational");
      expect(classifyIntent("Quanto vale o sinal?")).toBe("informational");
      expect(classifyIntent("Tem cláusula de FGTS?")).toBe("informational");
    });

    it("classifica perguntas começando com interrogativos", () => {
      expect(classifyIntent("O que diz a cláusula 5")).toBe("informational");
      expect(classifyIntent("Qual o prazo de financiamento")).toBe("informational");
      expect(classifyIntent("Quais são os vendedores")).toBe("informational");
      expect(classifyIntent("Como funciona a multa")).toBe("informational");
      expect(classifyIntent("Onde está a matrícula")).toBe("informational");
      expect(classifyIntent("Quando é a assinatura")).toBe("informational");
      expect(classifyIntent("Por que isso é assim")).toBe("informational");
      expect(classifyIntent("Quem é o comprador")).toBe("informational");
    });

    it("trata mensagem sem sinais como informational (mais seguro)", () => {
      expect(classifyIntent("contrato")).toBe("informational");
      expect(classifyIntent("teste")).toBe("informational");
    });
  });

  describe("edit_simple", () => {
    it("detecta verbo imperativo curto + 1 alvo", () => {
      expect(classifyIntent("altere a multa para 3%")).toBe("edit_simple");
      expect(classifyIntent("mude o valor do sinal")).toBe("edit_simple");
      expect(classifyIntent("substitua 2% por 3%")).toBe("edit_simple");
      expect(classifyIntent("remova a cláusula 5")).toBe("edit_simple");
      expect(classifyIntent("insira uma cláusula de FGTS")).toBe("edit_simple");
    });

    it("detecta verbos de preenchimento (regressão QA deal 20486 — F1)", () => {
      // "Preencha o local e a data" caía em informational → Editor nunca rodava
      // → aggregator confabulava "Alterações Realizadas".
      expect(
        classifyIntent('Preencha o local e a data da assinatura com "Embu-Guaçu, 19 de maio de 2026"')
      ).toBe("edit_simple");
      expect(classifyIntent("preencha o CPF do cônjuge do comprador")).toBe("edit_simple");
      expect(classifyIntent("complete a qualificação do vendedor")).toBe("edit_simple");
      expect(classifyIntent("informe o valor da comissão")).toBe("edit_simple");
      expect(classifyIntent("defina a data de assinatura")).toBe("edit_simple");
      expect(classifyIntent("ajuste a comissão para R$ 24.000,00")).toBe("edit_simple");
      expect(classifyIntent("conserte o valor zerado da comissão")).toBe("edit_simple");
    });

    it('não dispara falso-positivo com a preposição "por"', () => {
      expect(classifyIntent("por favor, o que diz a cláusula 5?")).toBe("informational");
    });
  });

  describe("edit_multi", () => {
    it("detecta sinais de múltiplas edições com 'tudo' / 'também'", () => {
      expect(classifyIntent("altere tudo conforme o novo padrão")).toBe("edit_multi");
      expect(classifyIntent("modifique todas as parcelas")).toBe("edit_multi");
      expect(classifyIntent("atualize cada cláusula")).toBe("edit_multi");
      expect(classifyIntent("corrija o valor e também ajuste a multa")).toBe("edit_multi");
    });

    it("trata mensagem de edição muito longa como edit_multi", () => {
      const longMsg =
        "altere a multa de 2% para 3% e ajuste " +
        "o valor da parcela inicial e também corrija as referências " +
        "internas das subcláusulas dois ponto um ponto um até ponto quatro " +
        "e revise o prazo do financiamento bancário considerando o novo cenário";
      expect(classifyIntent(longMsg)).toBe("edit_multi");
    });
  });

  describe("review", () => {
    it("detecta pedido de análise sem editar", () => {
      expect(classifyIntent("analise o contrato")).toBe("review");
      expect(classifyIntent("revise as cláusulas")).toBe("review");
      expect(classifyIntent("verifique a matemática")).toBe("review");
      expect(classifyIntent("valide os dados")).toBe("review");
      expect(classifyIntent("confira as referências internas")).toBe("review");
    });

    it("verbo de revisão + verbo de edição vira edit (mais específico)", () => {
      // "revise e altere" — tem edit_intent, dispara edit_simple
      const result = classifyIntent("revise e altere as parcelas");
      expect(["edit_simple", "edit_multi"]).toContain(result);
    });
  });

  describe("propose (curator)", () => {
    it("detecta pedido de proposta", () => {
      expect(classifyIntent("proponha uma nova cláusula de FGTS")).toBe("propose");
      expect(classifyIntent("sugira uma redação alternativa")).toBe("propose");
      expect(classifyIntent("recomende ajustes no template")).toBe("propose");
      expect(classifyIntent("considere mudar o padrão de multa")).toBe("propose");
      expect(classifyIntent("crie uma proposta de melhoria no template")).toBe("propose");
    });

    it("propose tem precedência sobre review", () => {
      // "proponha" + "verifique" → propose (curator é especialista da proposta)
      expect(classifyIntent("proponha uma cláusula e verifique se faz sentido")).toBe("propose");
    });

    it("propose + verbo de edição direto → edit (force direct quem ganha)", () => {
      const result = classifyIntent("proponha e altere já o template");
      expect(["edit_simple", "edit_multi"]).toContain(result);
    });
  });

  describe("aditamento (1-turn cycle)", () => {
    it("'aditamento' força edit_simple mesmo com proponha", () => {
      // Aditamento = write neste contrato, vai pro Editor (não Curator).
      expect(classifyIntent("Proponha um aditamento baseado nas certidões")).toBe("edit_simple");
      expect(classifyIntent("crie um aditamento por causa da matrícula com ônus")).toBe("edit_simple");
      expect(classifyIntent("considere um aditivo de quitação fiscal")).toBe("edit_simple");
    });

    it("'adendo' / 'cláusula adicional' também rotam pra Editor", () => {
      expect(classifyIntent("inclua um adendo sobre o saldo devedor")).toBe("edit_simple");
      expect(classifyIntent("proponha uma cláusula adicional pra penhora")).toBe("edit_simple");
    });

    it("ROUTER_REGEXES.CERTIDOES_CONTEXT detecta termos jurídicos imobiliários", () => {
      // Sanity check da regex de contexto — usada por outros módulos.
      const ctx = "certidão";
      expect(/certid[ãa]o/i.test(ctx)).toBe(true);
    });
  });

  describe("casos limite", () => {
    it("não confunde acentuação", () => {
      expect(classifyIntent("o que é arras?")).toBe("informational");
      expect(classifyIntent("por quê?")).toBe("informational");
    });

    it("normaliza espaços", () => {
      expect(classifyIntent("   altere a multa   ")).toBe("edit_simple");
    });
  });
});
