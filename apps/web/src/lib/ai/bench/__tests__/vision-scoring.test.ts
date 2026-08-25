import { describe, expect, it } from "vitest";
import {
  agregar,
  avaliar,
  compararCampos,
  normalizarParaComparar,
  type PlacarDocumento,
} from "../vision-scoring";

/**
 * As métricas que decidem qual modelo vai para produção.
 *
 * Testadas porque uma métrica que só existe dentro do script do bench não pode
 * ser verificada por ninguém — e o número que ela produz é o argumento inteiro
 * da troca de modelo.
 */
describe("normalizarParaComparar", () => {
  it("CPF com e sem pontuação é o mesmo CPF", () => {
    expect(normalizarParaComparar("529.982.247-25")).toBe(
      normalizarParaComparar("52998224725")
    );
  });

  it("data BR e ISO são a mesma data", () => {
    expect(normalizarParaComparar("12/05/1980")).toBe(
      normalizarParaComparar("1980-05-12")
    );
  });

  it("acento e caixa não são erro de leitura", () => {
    expect(normalizarParaComparar("JOÃO DA SILVA")).toBe(
      normalizarParaComparar("joao da silva")
    );
  });

  it("espaço duplicado não é erro de leitura", () => {
    expect(normalizarParaComparar("Rua  das   Acácias")).toBe(
      normalizarParaComparar("Rua das Acacias")
    );
  });

  it("nulo e vazio colapsam", () => {
    expect(normalizarParaComparar(null)).toBe("");
    expect(normalizarParaComparar("   ")).toBe("");
  });

  /**
   * Valor monetário e identificador NÃO podem ser tratados iguais. Confundir
   * os dois marcava alucinação em `valor_transacao`, que é campo crítico e
   * alimenta o veto do bench — o modelo certo seria reprovado por formatação.
   */
  it("valor monetário vale o NÚMERO, em qualquer notação", () => {
    const alvo = normalizarParaComparar("R$ 350.000,00");
    expect(normalizarParaComparar(350000)).toBe(alvo);
    expect(normalizarParaComparar("350000")).toBe(alvo);
    expect(normalizarParaComparar("350000.00")).toBe(alvo);
    expect(normalizarParaComparar("350.000,00")).toBe(alvo);
  });

  it("área com e sem unidade é a mesma área", () => {
    expect(normalizarParaComparar("87,45 m²")).toBe(normalizarParaComparar("87.45"));
  });

  it("identificador vale a SEQUÊNCIA, não o valor", () => {
    // Um CPF não é um número: zeros à esquerda importam e não há aritmética.
    expect(normalizarParaComparar("012.345.678-90")).toBe("01234567890");
    expect(normalizarParaComparar("05433-010")).toBe("05433010");
  });

  /**
   * `String(valor)` colapsava qualquer objeto em "[object Object]", então dois
   * arrays COMPLETAMENTE diferentes eram contados como acerto — crédito de
   * graça justamente nos campos mais difíceis (partes[] da ficha-resumo).
   */
  it("estrutura é comparada pelo conteúdo, não por [object Object]", () => {
    const a = normalizarParaComparar([{ nome: "Joao" }]);
    const b = normalizarParaComparar([{ nome: "Maria" }]);
    expect(a).not.toBe(b);
    expect(a).not.toContain("[object Object]");
  });

  it("mesma estrutura em ordem de chave diferente é igual", () => {
    expect(normalizarParaComparar({ a: 1, b: 2 })).toBe(
      normalizarParaComparar({ b: 2, a: 1 })
    );
  });

  it("array com mesmos itens em ordem diferente NÃO é igual", () => {
    // Ordem de `partes[]` é significativa: "Vendedor 1" e "Vendedor 2" têm
    // índice de referência, e trocá-los troca as pessoas de papel.
    expect(normalizarParaComparar([{ n: "a" }, { n: "b" }])).not.toBe(
      normalizarParaComparar([{ n: "b" }, { n: "a" }])
    );
  });
});

describe("compararCampos — alucinação × omissão", () => {
  /**
   * A distinção que organiza o bench inteiro: campo vazio o corretor percebe,
   * campo errado ele assina. Colapsar os dois numa "acurácia" única esconderia
   * a diferença que decide se um modelo pode ir para produção.
   */
  it("campo vazio quando o documento tem valor é OMISSÃO", () => {
    const [r] = compararCampos({ cpf_numero: "52998224725" }, { cpf_numero: null });
    expect(r.omitiu).toBe(true);
    expect(r.alucinou).toBe(false);
  });

  it("campo com valor errado é ALUCINAÇÃO", () => {
    const [r] = compararCampos(
      { cpf_numero: "52998224725" },
      { cpf_numero: "11122233344" }
    );
    expect(r.alucinou).toBe(true);
    expect(r.omitiu).toBe(false);
  });

  /**
   * Gabarito vazio significa "o documento NÃO tem este campo". Aí a polaridade
   * inverte: o certo é o modelo não devolver nada, e devolver algo é invenção
   * pura — o valor não existe no papel.
   */
  it("inventar campo que o documento não tem é alucinação", () => {
    const [r] = compararCampos({ conjuge_nome: "" }, { conjuge_nome: "Maria" });
    expect(r.alucinou).toBe(true);
    expect(r.acertou).toBe(false);
  });

  it("deixar vazio o que o documento não tem é acerto", () => {
    const [r] = compararCampos({ conjuge_nome: "" }, { conjuge_nome: null });
    expect(r.acertou).toBe(true);
    expect(r.alucinou).toBe(false);
  });

  it("campo crítico pesa mais que campo comum", () => {
    const [critico] = compararCampos({ cpf_numero: "1" }, { cpf_numero: "1" });
    const [comum] = compararCampos({ bairro: "x" }, { bairro: "x" });
    expect(critico.peso).toBeGreaterThan(comum.peso);
  });

  it("saída não-parseável conta como omissão em tudo, não como acerto", () => {
    const rs = compararCampos({ cpf_numero: "52998224725", bairro: "Centro" }, null);
    expect(rs.every((r) => r.omitiu)).toBe(true);
    expect(rs.some((r) => r.acertou)).toBe(false);
  });
});

const placar = (over: Partial<PlacarDocumento> = {}): PlacarDocumento => ({
  campos: [],
  categoriaCorreta: true,
  jsonAproveitavel: true,
  latenciaMs: 1000,
  custoUsd: 0.001,
  ...over,
});

describe("agregar", () => {
  it("acurácia é PONDERADA — errar CPF dói mais que errar bairro", () => {
    const erraCritico = agregar([
      placar({
        campos: [
          ...compararCampos({ cpf_numero: "1" }, { cpf_numero: "2" }),
          ...compararCampos({ bairro: "x" }, { bairro: "x" }),
        ],
      }),
    ]);
    const erraComum = agregar([
      placar({
        campos: [
          ...compararCampos({ cpf_numero: "1" }, { cpf_numero: "1" }),
          ...compararCampos({ bairro: "x" }, { bairro: "y" }),
        ],
      }),
    ]);
    expect(erraComum.acuraciaPonderada).toBeGreaterThan(erraCritico.acuraciaPonderada);
  });

  it("p95 não interpola — devolve um valor que alguma execução produziu", () => {
    const a = agregar([10, 20, 30, 1000].map((ms) => placar({ latenciaMs: ms })));
    expect([10, 20, 30, 1000]).toContain(a.latenciaP95);
    expect(a.latenciaP95).toBe(1000);
  });

  it("corpus vazio devolve zeros, não NaN", () => {
    const a = agregar([]);
    expect(Object.values(a).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("custo por documento divide pelo número de documentos", () => {
    const a = agregar([placar({ custoUsd: 0.002 }), placar({ custoUsd: 0.004 })]);
    expect(a.custoPorDocUsd).toBeCloseTo(0.003, 6);
  });
});

/** Placar com N comparações, para os testes atingirem o volume mínimo. */
const placarComN = (n: number, over: Partial<PlacarDocumento> = {}) =>
  placar({
    campos: Array.from({ length: n }, () =>
      compararCampos({ bairro: "x" }, { bairro: "x" })
    ).flat(),
    ...over,
  });

describe("avaliar — volume mínimo", () => {
  /**
   * O critério original comparava taxas com `>` estrito. Parecia rigoroso e era
   * inútil: com ~150 comparações, 1 ponto percentual é UMA ocorrência, e a taxa
   * do próprio baseline oscilou 2,2% → 1,9% → 0,6% entre execuções idênticas.
   *
   * O teste que desmascara não é um candidato reprovado — é o BASELINE
   * reprovando a si mesmo.
   */
  it("recusa veredito quando a amostra é pequena demais", () => {
    const pequeno = agregar([placarComN(50)]);
    const v = avaliar(pequeno, pequeno);
    expect(v.aprovado).toBe(false);
    expect(v.motivos.join(" ")).toMatch(/amostra pequena/i);
  });

  it("com volume suficiente, volta a emitir veredito", () => {
    const grande = agregar([placarComN(400)]);
    expect(avaliar(grande, grande).aprovado).toBe(true);
  });
});

describe("avaliar — critério de aceitação", () => {
  const base = agregar([placarComN(400)]);

  /**
   * O ponto do veto: um modelo mais preciso NA MÉDIA mas que inventa mais
   * reprova. O campo errado viaja para o contrato, a certidão e a assinatura
   * sem ninguém conferir.
   */
  /**
   * O caso real que expôs o problema: baseline 0,6% contra candidato 2,6% são
   * 1 contra 4 ocorrências em 154 comparações (z = 1,35, indistinguível de
   * ruído). Vetar aí é deixar o sorteio decidir qual modelo vai para produção.
   */
  it("diferença pequena de alucinação NÃO veta — é ruído, não sinal", () => {
    const v = avaliar(base, { ...base, taxaAlucinacao: base.taxaAlucinacao + 0.015 });
    expect(v.aprovado).toBe(true);
  });

  it("alucinar mais reprova mesmo com acurácia melhor", () => {
    const candidato = { ...base, acuraciaPonderada: 0.99, taxaAlucinacao: base.taxaAlucinacao + 0.05 };
    const v = avaliar(base, candidato);
    expect(v.aprovado).toBe(false);
    expect(v.motivos.join(" ")).toMatch(/veto/i);
  });

  it("acurácia abaixo do baseline reprova", () => {
    const v = avaliar(base, { ...base, acuraciaPonderada: base.acuraciaPonderada - 0.1 });
    expect(v.aprovado).toBe(false);
  });

  /**
   * Onde o Gemma sangra: ele emite cerca markdown sobrando em ~1/3 das
   * chamadas. O parser tolerante salva, mas a taxa precisa ser medida.
   */
  it("devolver JSON aproveitável com menos frequência reprova", () => {
    const v = avaliar(base, { ...base, jsonAproveitavel: base.jsonAproveitavel - 0.2 });
    expect(v.aprovado).toBe(false);
    expect(v.motivos.join(" ")).toMatch(/JSON/i);
  });

  it("p95 muito acima reprova — o worker tem maxDuration e cron de 1 min", () => {
    const b = { ...base, latenciaP95: 1000 };
    expect(avaliar(b, { ...b, latenciaP95: 1600 }).aprovado).toBe(false);
    expect(avaliar(b, { ...b, latenciaP95: 1400 }).aprovado).toBe(true);
  });

  it("empatar em tudo aprova — aí decide custo", () => {
    expect(avaliar(base, { ...base }).aprovado).toBe(true);
  });

  /**
   * O modo de falha mais perigoso do harness: braço cujas chamadas TODAS
   * falharam agrega em zeros, e zeros passavam em toda comparação — saía
   * "APROVADO" para um modelo que não respondeu nada.
   */
  it("braço sem medição nenhuma NÃO é braço aprovado", () => {
    const vazio = agregar([]);
    const v = avaliar(base, vazio);
    expect(v.aprovado).toBe(false);
    expect(v.motivos.join(" ")).toMatch(/sem dado|nenhuma chamada/i);
  });

  /**
   * O espelho: baseline vazio tem alucinação 0 e p95 0, então reprovaria todo
   * candidato contra algo que nunca rodou. "Não medi" não é veredito.
   */
  it("baseline sem medição não reprova ninguém — recusa comparar", () => {
    const v = avaliar(agregar([]), base);
    expect(v.aprovado).toBe(false);
    expect(v.motivos.join(" ")).toMatch(/baseline/i);
  });
});
