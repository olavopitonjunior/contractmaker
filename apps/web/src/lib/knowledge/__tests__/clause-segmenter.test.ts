import { describe, it, expect } from "vitest";
import { segmentClauses, countClauseHeaders } from "../clause-segmenter";

const CLAUSULAS_POR_EXTENSO = `CLÁUSULA PRIMEIRA - DO OBJETO
O presente instrumento tem por objeto a promessa de compra e venda do imóvel descrito no preâmbulo, livre e desembaraçado de quaisquer ônus.

CLÁUSULA SEGUNDA - DO PREÇO
O preço certo e ajustado é de R$ 500.000,00 (quinhentos mil reais), pago na forma da tabela abaixo, valendo os comprovantes como recibo.

CLÁUSULA DÉCIMA SEGUNDA - DA LGPD
As partes se comprometem a tratar os dados pessoais coletados neste instrumento nos termos da Lei nº 13.709/2018.`;

const CLAUSULAS_NUMERO_ORDINAL = `CLÁUSULA 1ª — DO OBJETO E DA DESTINAÇÃO
O imóvel destina-se exclusivamente a fins residenciais do LOCATÁRIO e de sua família.

CLÁUSULA 2ª — DO PRAZO
O prazo da locação é de 30 (trinta) meses, contados da data de entrega das chaves.

CLÁUSULA 3ª — DO ALUGUEL E DA FORMA DE PAGAMENTO
O aluguel mensal é de R$ 2.500,00, vencível todo dia 5 de cada mês, por boleto bancário.`;

describe("segmentClauses", () => {
  it("segmenta por CLÁUSULA por extenso e extrai o título completo da linha", () => {
    const segments = segmentClauses(CLAUSULAS_POR_EXTENSO);
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.title)).toEqual([
      "CLÁUSULA PRIMEIRA - DO OBJETO",
      "CLÁUSULA SEGUNDA - DO PREÇO",
      "CLÁUSULA DÉCIMA SEGUNDA - DA LGPD",
    ]);
    // o conteúdo inclui o cabeçalho — a cláusula precisa ser autossuficiente
    expect(segments[0].content.startsWith("CLÁUSULA PRIMEIRA")).toBe(true);
    expect(segments[1].content).toContain("quinhentos mil reais");
    // nada do bloco seguinte vaza pro anterior
    expect(segments[0].content).not.toContain("PREÇO");
  });

  it("segmenta por CLÁUSULA com numeral ordinal e travessão", () => {
    const segments = segmentClauses(CLAUSULAS_NUMERO_ORDINAL);
    expect(segments).toHaveLength(3);
    expect(segments[2].title).toBe("CLÁUSULA 3ª — DO ALUGUEL E DA FORMA DE PAGAMENTO");
  });

  it("segmenta por numeração de topo quando não há a palavra CLÁUSULA", () => {
    const text = `1. DO OBJETO
Venda do imóvel matriculado sob o nº 12.345 do 5º CRI da Capital.

2. DAS OBRIGAÇÕES
O vendedor obriga-se a entregar o imóvel livre de pessoas e coisas em 30 dias.

3 - DO FORO
Fica eleito o foro da Comarca de São Paulo para dirimir controvérsias.`;
    const segments = segmentClauses(text);
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.title)).toEqual([
      "1. DO OBJETO",
      "2. DAS OBRIGAÇÕES",
      "3 - DO FORO",
    ]);
  });

  it("prefere CLÁUSULA a subitens numerados — subitem fica dentro da cláusula", () => {
    const text = `CLÁUSULA PRIMEIRA - DO OBJETO
1.1 O imóvel objeto deste contrato é o apartamento nº 71.
1.2 A vaga de garagem acompanha a unidade autônoma descrita acima.

CLÁUSULA SEGUNDA - DO PREÇO
2.1 O preço é de R$ 500.000,00, pago em parcela única no ato da assinatura.`;
    const segments = segmentClauses(text);
    expect(segments).toHaveLength(2);
    expect(segments[0].content).toContain("1.2 A vaga de garagem");
  });

  it("usa numeração multinível quando não há nível de topo", () => {
    const text = `2.1 O locatário responde pelos tributos incidentes sobre o imóvel locado.
2.2 As despesas ordinárias de condomínio correm por conta do locatário.
2.3 As despesas extraordinárias permanecem a cargo do locador, na forma da lei.`;
    const segments = segmentClauses(text);
    expect(segments).toHaveLength(3);
    expect(segments[0].title).toBe("2.1 O locatário responde pelos tributos incidentes sobre o imóvel locado");
  });

  it("devolve lista vazia quando há menos de 2 cláusulas", () => {
    expect(segmentClauses("CLÁUSULA ÚNICA - DO FORO\nFica eleito o foro da Capital.")).toEqual([]);
    expect(segmentClauses("")).toEqual([]);
  });

  it("devolve lista vazia em texto corrido (sem cabeçalhos)", () => {
    const prosa = `A Lei do Inquilinato disciplina a locação de imóveis urbanos. O prazo de 30 meses
permite a retomada por denúncia vazia ao final do contrato, sem necessidade de motivação.
Em contratos com prazo inferior, a retomada depende das hipóteses legais.`;
    expect(segmentClauses(prosa)).toEqual([]);
  });

  it("não confunde frase iniciada por número com cabeçalho", () => {
    const text = `10 dias corridos após a assinatura, o imóvel será vistoriado pelas partes.
30 dias é o prazo máximo para a entrega das chaves ao comprador.`;
    expect(segmentClauses(text)).toEqual([]);
    expect(countClauseHeaders(text)).toBe(0);
  });

  it("descarta segmentos curtos demais para serem cláusulas", () => {
    const text = `1. A
2. B
3. C`;
    expect(segmentClauses(text)).toEqual([]);
  });

  it("trunca título longo em fronteira de palavra", () => {
    const longo = "CLÁUSULA PRIMEIRA - " + "palavra ".repeat(40);
    const segments = segmentClauses(
      `${longo}\ntexto suficiente para o bloco\n\nCLÁUSULA SEGUNDA - DO PREÇO\nO preço é de R$ 1,00 (um real).`
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].title.length).toBeLessThanOrEqual(121);
    // corta em palavra íntegra (nunca no meio de "palavra")
    expect(segments[0].title).toMatch(/palavra…$/);
  });

  it("countClauseHeaders reflete a mesma estratégia da segmentação", () => {
    expect(countClauseHeaders(CLAUSULAS_POR_EXTENSO)).toBe(3);
    expect(countClauseHeaders(CLAUSULAS_NUMERO_ORDINAL)).toBe(3);
  });
});
