import { describe, it, expect } from "vitest";
import { planInsertion } from "../ai-placeholder-insertion";

/**
 * As travas do passe decidiam-se no meio de uma função que também falava com a
 * Anthropic e com o Google — testá-las exigia mocar as duas pontas. Agora
 * `planInsertion` é pura: mesma entrada, mesmo plano, sem rede. Estes casos
 * exercem a segurança do replace GLOBAL, que é o que impede o passe de
 * estragar um documento.
 */
const M = (token: string, trecho_literal: string) => ({ token, trecho_literal });

function plan(docText: string, mapeamentos: Array<{ token: string; trecho_literal: string }>) {
  return planInsertion({ docText, modalidade: "locacao", mapeamentos });
}

const reasons = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(p.skippedAmbiguous.map((s) => [s.token, s.reason]));

describe("planInsertion — travas do texto plano", () => {
  it("trecho único vira request e some do texto simulado", () => {
    const doc = "LOCADOR: João da Silva, brasileiro.\nCláusula 1.";
    const p = plan(doc, [M("locadores_qualificacao", "João da Silva, brasileiro")]);
    expect(p.candidates).toHaveLength(1);
    expect(p.requests).toHaveLength(1);
    expect(p.simulatedText).toContain("{{locadores_qualificacao}}");
    expect(p.simulatedText).not.toContain("João da Silva, brasileiro");
  });

  it("trecho repetido é ambíguo e NÃO vira request", () => {
    const doc = "Pagar a taxa.\nOutra cláusula.\nPagar a taxa.";
    const p = plan(doc, [M("aluguel_valor", "Pagar a taxa")]);
    expect(p.candidates).toHaveLength(0);
    expect(p.requests).toHaveLength(0);
    expect(reasons(p)).toEqual({ aluguel_valor: "ambiguous" });
  });

  it("trecho inexistente é not-found", () => {
    const p = plan("Contrato.", [M("aluguel_valor", "texto que não existe")]);
    expect(reasons(p)).toEqual({ aluguel_valor: "not-found" });
  });

  it("trecho que já tem chave é recusado antes de qualquer contagem", () => {
    const p = plan("já tem {{aluguel_valor}} aqui", [
      M("aluguel_valor", "já tem {{aluguel_valor}} aqui"),
    ]);
    expect(reasons(p)).toEqual({ aluguel_valor: "already-tokenized" });
  });

  it("token fora do catálogo da modalidade é recusado", () => {
    const p = plan("Qualquer texto aqui.", [M("token_inventado", "Qualquer texto aqui")]);
    expect(reasons(p)).toEqual({ token_inventado: "unknown-token" });
  });

  it("longest-first: o bloco maior entra e o trecho contido sai como overlapped", () => {
    const doc = "LOCADOR: João da Silva, brasileiro, casado, engenheiro.";
    const p = plan(doc, [
      M("locadores_qualificacao", "João da Silva, brasileiro, casado, engenheiro"),
      M("aluguel_valor", "João da Silva"),
    ]);
    expect(p.candidates.map((c) => c.token)).toEqual(["locadores_qualificacao"]);
    expect(reasons(p)).toEqual({ aluguel_valor: "overlapped" });
  });

  it("chave de dado que engole a proposta da vizinha é recusada, e a vizinha entra", () => {
    // O incidente do #530: o item a) inteiro entrou como qualificação e a conta
    // ficou de fora. A vizinha (menor) precisa sobreviver à recusa.
    const conta = "Banco 001, agência 1234, conta 56789";
    const itemA = `a) pago à imobiliária intermediadora Trio Ltda, ${conta}, pela intermediação`;
    const p = plan(`${itemA}.`, [
      M("imobiliaria_qualificacao", itemA),
      M("imobiliaria_dados_pagamento", conta),
    ]);
    expect(reasons(p)).toEqual({ imobiliaria_qualificacao: "engulfs-neighbor" });
    expect(p.candidates.map((c) => c.token)).toEqual(["imobiliaria_dados_pagamento"]);
    expect(p.skippedAmbiguous[0].neighbor).toBe("imobiliaria_dados_pagamento");
  });

  it("bloco composto proposto duas vezes entra uma só, sem virar ruído no relatório", () => {
    const doc = "LOCADOR: João da Silva.\nO LOCADOR: Maria Souza.";
    const p = plan(doc, [
      M("locadores_qualificacao", "João da Silva"),
      M("locadores_qualificacao", "Maria Souza"),
    ]);
    expect(p.candidates).toHaveLength(1);
    // Descarte deliberado: não é falha a corrigir, é o passe recusando duplicar.
    expect(p.skippedAmbiguous).toHaveLength(0);
  });

  it("token simples aceita vários trechos — o valor aparece em mais de uma cláusula", () => {
    const doc = "O aluguel é de R$ 2.500,00 mensais.\nA multa incide sobre R$ 2.500,00 do aluguel.";
    const p = plan(doc, [
      M("aluguel_valor", "R$ 2.500,00 mensais"),
      M("aluguel_valor", "R$ 2.500,00 do aluguel"),
    ]);
    expect(p.candidates).toHaveLength(2);
  });

  it("bloco multi-parágrafo: o 1º vira chave, os demais viram request de esvaziar", () => {
    const doc = ["Assinam as partes:", "LOCADOR", "LOCATÁRIO", "Testemunhas"].join("\n");
    const p = plan(doc, [M("assinaturas", "Assinam as partes:\nLOCADOR\nLOCATÁRIO")]);
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0].rest.map((r) => r.par)).toEqual(["LOCADOR", "LOCATÁRIO"]);
    expect(p.requests).toHaveLength(3);
    expect(p.simulatedText.split("\n").filter(Boolean)).toEqual([
      "{{assinaturas}}",
      "Testemunhas",
    ]);
  });

  it("bloco composto cujos parágrafos NÃO são consecutivos é recusado inteiro", () => {
    // A IA pulou "meio": o trecho não é uma sequência no documento. Esvaziar
    // "repetido" onde quer que ele estivesse (a versão anterior) apagava texto
    // fora do bloco; agora nada é enviado.
    const doc = ["Bloco X", "meio", "repetido", "outro", "repetido"].join("\n");
    const p = plan(doc, [M("assinaturas", "Bloco X\nrepetido")]);
    expect(p.blocks).toHaveLength(0);
    expect(p.candidates).toHaveLength(0);
    expect(reasons(p)).toEqual({ assinaturas: "block-not-consecutive" });
  });

  it("parágrafo único do bloco que também existe SOLTO em outro lugar não é esvaziado lá", () => {
    // "Nome" existe no bloco e, sozinho, numa ficha no fim do documento. O
    // caminho de texto trocaria os dois; a sequência manda o bloco pelo
    // caminho estrutural e a ficha fica intacta.
    const doc = ["____", "Nome", "PARTE LOCADORA", "____", "Testemunha", "Ficha:", "Nome"].join("\n");
    const p = plan(doc, [M("assinaturas", "____\nNome\nPARTE LOCADORA\n____\nTestemunha")]);
    expect(p.blocks).toHaveLength(1);
    expect(p.requests).toHaveLength(0);
    expect(p.simulatedText).toBe("{{assinaturas}}\nFicha:\nNome");
  });

  it("bloco com parágrafo repetido, mas SEQUÊNCIA única, entra pelo caminho estrutural", () => {
    // O bloco de assinaturas da Trio: "____" uma vez por signatário e "PARTE
    // LOCATÁRIA" dezenas de vezes no contrato. Nenhum parágrafo é único; a
    // sequência é. Antes: `ambiguous` em 16 de 16 modelos.
    const doc = [
      "Cláusula final. A PARTE LOCATÁRIA assina.",
      "____",
      "Nome",
      "PARTE LOCATÁRIA",
      "____",
      "Nome",
      "PARTE LOCADORA",
      "Rodapé",
    ].join("\n");
    const p = plan(doc, [
      M("assinaturas", "____\nNome\nPARTE LOCATÁRIA\n____\nNome\nPARTE LOCADORA"),
    ]);
    expect(p.candidates).toHaveLength(0);
    expect(p.requests).toHaveLength(0);
    expect(p.blocks).toEqual([
      expect.objectContaining({
        token: "assinaturas",
        paragraphs: ["____", "Nome", "PARTE LOCATÁRIA", "____", "Nome", "PARTE LOCADORA"],
      }),
    ]);
    expect(p.skippedAmbiguous).toEqual([]);
    expect(p.simulatedText.split("\n")).toEqual([
      "Cláusula final. A PARTE LOCATÁRIA assina.",
      "{{assinaturas}}",
      "Rodapé",
    ]);
  });

  it("bloco cuja sequência aparece duas vezes é ambíguo, sem caminho estrutural", () => {
    const doc = ["____", "Nome", "x", "____", "Nome"].join("\n");
    const p = plan(doc, [M("assinaturas", "____\nNome")]);
    expect(p.blocks).toHaveLength(0);
    expect(reasons(p)).toEqual({ assinaturas: "ambiguous" });
  });

  it("bloco de um parágrafo só nunca vai pelo caminho estrutural", () => {
    const doc = ["A", "B", "A"].join("\n");
    const p = plan(doc, [M("assinaturas", "A")]);
    expect(p.blocks).toHaveLength(0);
    expect(reasons(p)).toEqual({ assinaturas: "ambiguous" });
  });

  it("o texto simulado é a base da unicidade dos candidatos seguintes", () => {
    // Sem simular, os dois passariam e o segundo casaria zero no Docs.
    const doc = "A cláusula fala do imóvel na Rua das Flores, 100, matrícula 99.001.";
    const p = plan(doc, [
      M("imovel_endereco_completo", "Rua das Flores, 100, matrícula 99.001"),
      M("imovel_matricula", "matrícula 99.001"),
    ]);
    expect(p.candidates.map((c) => c.token)).toEqual(["imovel_endereco_completo"]);
    expect(reasons(p)).toEqual({ imovel_matricula: "overlapped" });
  });

  it("a lista de rateio entra como UMA chave, sem levar o cabeçalho", () => {
    // O caso da Trio: a 4.1.1 abre a lista e os itens somam um aluguel. Chaveado
    // item por item o resultado é sempre errado (cada chave de corretagem
    // imprime a lista inteira de beneficiários), então a lista é uma chave só —
    // e o cabeçalho, que é texto fixo, fica FORA dela.
    const cabecalho =
      "4.1.1. O pagamento correspondente ao primeiro aluguel será rateado da seguinte forma:";
    const lista = [
      "a) R$ 2.500,00 (dois mil e quinhentos reais), a ser pago diretamente à imobiliária intermediadora Trio Ltda;",
      "b) R$ 1.500,00 (mil e quinhentos reais), a ser pago diretamente ao(à) corretor(a) intermediador(a) Ana Ribeiro.",
    ].join("\n");
    const doc = [cabecalho, lista, "4.1.2. Os valores acima serão retidos no primeiro repasse."].join("\n");

    const p = plan(doc, [M("rateio_primeiro_aluguel", lista)]);

    expect(p.candidates.map((c) => c.token)).toEqual(["rateio_primeiro_aluguel"]);
    expect(p.simulatedText).toContain(cabecalho);
    expect(p.simulatedText).toContain("{{rateio_primeiro_aluguel}}");
    expect(p.simulatedText).not.toContain("Ana Ribeiro");
    // Bloco multi-parágrafo: o 1º item vira a chave, o 2º é esvaziado.
    expect(p.candidates[0].rest.map((r) => r.par)).toEqual([
      "b) R$ 1.500,00 (mil e quinhentos reais), a ser pago diretamente ao(à) corretor(a) intermediador(a) Ana Ribeiro.",
    ]);
  });

  it("o plano carrega a impressão do texto contra o qual foi montado", async () => {
    const { commitInsertion, PlanTextMismatchError } = await import("../ai-placeholder-insertion");
    const p = plan("LOCADOR: João da Silva, brasileiro.", [
      M("locadores_qualificacao", "João da Silva, brasileiro"),
    ]);
    // Aplicar este plano sobre OUTRO documento escreveria trechos casados
    // contra um texto que não é o dele. A recusa vem antes de qualquer escrita.
    await expect(
      commitInsertion({
        docId: "doc-de-outro-contrato",
        docText: "Um documento completamente diferente.",
        modalidade: "locacao",
        plan: p,
        flags: { docTruncated: false, responseTruncated: false, responseUnparsed: false },
      })
    ).rejects.toBeInstanceOf(PlanTextMismatchError);
  });

  it("plano vazio para proposta vazia", () => {
    const p = plan("Contrato qualquer.", []);
    expect(p).toMatchObject({ requests: [], candidates: [], skippedAmbiguous: [] });
    expect(p.simulatedText).toBe("Contrato qualquer.");
  });
});

describe("planInsertion — o que a Trio ensinou em 04/09/2026", () => {
  it("NBSP no documento × espaço na proposta: casa, e o Docs recebe a forma REAL", () => {
    // "8.1.\u00A0Como garantia" no DOCX; o modelo devolve com espaço comum.
    const doc = "Cláusula 8.\n8.1.\u00A0Como garantia das obrigações, caução de R$ 1.000,00.\nCláusula 9.";
    const p = plan(doc, [
      M("clausula_garantia", "8.1. Como garantia das obrigações, caução de R$ 1.000,00."),
    ]);
    expect(reasons(p)).toEqual({});
    expect(p.candidates).toHaveLength(1);
    const req = p.requests[0]!.replaceAllText!;
    expect(req.containsText!.text).toBe("8.1.\u00A0Como garantia das obrigações, caução de R$ 1.000,00.");
    expect(p.simulatedText).toBe("Cláusula 8.\n{{clausula_garantia}}\nCláusula 9.");
  });

  it("NBSP na proposta × espaço no documento: idem", () => {
    const doc = "Aluguel de R$ 1.000,00 mensais.";
    const p = plan(doc, [M("aluguel_valor", "R$\u00A01.000,00")]);
    expect(p.candidates[0]!.first).toBe("R$ 1.000,00");
    expect(p.simulatedText).toBe("Aluguel de {{aluguel_valor}} mensais.");
  });

  it("valor + extenso na mesma proposta: apara o valor e os DOIS entram", () => {
    const doc = "O aluguel mensal é de R$ 3.000,00 (três mil reais), pago até o dia 10.";
    const p = plan(doc, [
      M("aluguel_valor", "R$ 3.000,00 (três mil reais)"),
      M("aluguel_valor_extenso", "três mil reais"),
    ]);
    expect(reasons(p)).toEqual({});
    expect(p.simulatedText).toBe(
      "O aluguel mensal é de {{aluguel_valor}} ({{aluguel_valor_extenso}}), pago até o dia 10."
    );
  });

  it("valor + extenso com espaço dentro do parêntese: o par ainda é reconhecido", () => {
    const doc = "Aluguel de R$ 3.000,00 ( três mil reais ) mensais.";
    const p = plan(doc, [
      M("aluguel_valor", "R$ 3.000,00 ( três mil reais )"),
      M("aluguel_valor_extenso", "três mil reais"),
    ]);
    expect(p.simulatedText).toBe("Aluguel de {{aluguel_valor}} ( {{aluguel_valor_extenso}} ) mensais.");
  });

  it("extenso sem o par exato não apara nada (o longest-first de sempre)", () => {
    const doc = "Valor: R$ 3.000,00 - três mil reais.";
    const p = plan(doc, [
      M("aluguel_valor", "R$ 3.000,00 - três mil reais"),
      M("aluguel_valor_extenso", "três mil reais"),
    ]);
    expect(p.simulatedText).toBe("Valor: {{aluguel_valor}}.");
    expect(reasons(p)).toEqual({ aluguel_valor_extenso: "overlapped" });
  });

  it("chave simples que engole DUAS outras é frase, não valor: recusada, as duas entram", () => {
    const doc =
      "Prazo: 30 (trinta) meses, a contar de 1º de março de 2025 e com término em 28 de fevereiro de 2028.";
    const p = plan(doc, [
      M(
        "vigencia_meses",
        "30 (trinta) meses, a contar de 1º de março de 2025 e com término em 28 de fevereiro de 2028"
      ),
      M("vigencia_inicio", "1º de março de 2025"),
      M("vigencia_fim", "28 de fevereiro de 2028"),
    ]);
    expect(reasons(p)).toEqual({ vigencia_meses: "engulfs-neighbor" });
    expect(p.simulatedText).toBe(
      "Prazo: 30 (trinta) meses, a contar de {{vigencia_inicio}} e com término em {{vigencia_fim}}."
    );
  });

  it("chave simples que contém UMA outra não decide: o longest-first vale", () => {
    const doc = "Imóvel: apartamento 45, matrícula 99.001 do 5º RI.";
    const p = plan(doc, [
      M("imovel_descricao", "apartamento 45, matrícula 99.001 do 5º RI"),
      M("imovel_matricula", "99.001"),
    ]);
    expect(p.candidates.map((c) => c.token)).toEqual(["imovel_descricao"]);
    expect(reasons(p)).toEqual({ imovel_matricula: "overlapped" });
  });
});
