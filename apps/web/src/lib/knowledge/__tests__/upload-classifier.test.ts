import { describe, it, expect } from "vitest";
import { classifyByHeuristics, collectSignals } from "../upload-classifier";
import { VENDAS_SEED_CLAUSES } from "../seed-clauses-vendas";

/** Contrato canônico: título + qualificação das partes + cláusulas + fecho. */
const CONTRATO_COMPLETO = `INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA DE IMÓVEL

PROMITENTE VENDEDOR: JOÃO DA SILVA, brasileiro, casado, engenheiro, portador da cédula de identidade RG nº 12.345.678-9 SSP/SP, inscrito no CPF sob o nº 123.456.789-00, residente e domiciliado na Rua das Flores, 100, São Paulo/SP, doravante denominado simplesmente VENDEDOR.

PROMISSÁRIO COMPRADOR: MARIA SOUZA, brasileira, solteira, advogada, inscrita no CPF sob o nº 987.654.321-00, residente e domiciliada na Av. Paulista, 1000, São Paulo/SP, doravante denominada simplesmente COMPRADORA.

CLÁUSULA PRIMEIRA - DO OBJETO
O objeto do presente é o imóvel matriculado sob o nº 12.345 do 5º Cartório de Registro de Imóveis da Capital.

CLÁUSULA SEGUNDA - DO PREÇO
O preço certo e ajustado é de R$ 500.000,00 (quinhentos mil reais), pago na forma abaixo estabelecida.

CLÁUSULA TERCEIRA - DA POSSE
A imissão na posse dar-se-á em até 30 (trinta) dias corridos do pagamento integral do preço.

CLÁUSULA QUARTA - DO FORO
Fica eleito o foro da Comarca de São Paulo, com renúncia a qualquer outro.

E por estarem assim justos e contratados, firmam o presente instrumento em 2 (duas) vias de igual teor.

São Paulo, 15 de março de 2026.

_______________________________
JOÃO DA SILVA

_______________________________
MARIA SOUZA

TESTEMUNHAS:
`;

/** Coleção de cláusulas soltas — sem partes qualificadas e sem fecho. */
const COLECAO_CLAUSULAS = `CLÁUSULA PRIMEIRA - ARRAS CONFIRMATÓRIAS
${stripTags(VENDAS_SEED_CLAUSES[0].content)}

CLÁUSULA SEGUNDA - RESCISÃO AUTOMÁTICA POR NÃO PAGAMENTO DO SINAL
${stripTags(VENDAS_SEED_CLAUSES[1].content)}

CLÁUSULA TERCEIRA - PAGAMENTO PROPORCIONAL EM CONTAS INDICADAS
${stripTags(VENDAS_SEED_CLAUSES[2].content)}

CLÁUSULA QUARTA - POSSE APÓS PAGAMENTO INTEGRAL
${stripTags(VENDAS_SEED_CLAUSES[3].content)}
`;

/** Material de referência em prosa — nem contrato nem coleção. */
const TEXTO_CORRIDO = `A Lei nº 8.245/1991, conhecida como Lei do Inquilinato, disciplina as locações
de imóveis urbanos no Brasil. A denúncia vazia ao final do prazo contratual é
admitida nos contratos escritos com prazo igual ou superior a trinta meses,
dispensando o locador de justificar a retomada do bem.

Nos contratos por prazo inferior, ou naqueles prorrogados por tempo
indeterminado, a retomada depende das hipóteses previstas no artigo 47 do mesmo
diploma legal, sob pena de improcedência da ação de despejo.

A jurisprudência dominante do Superior Tribunal de Justiça reafirma que a
garantia locatícia não pode ser cumulada, sendo nula a exigência simultânea de
fiança e caução.`;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\{\{[^}]+\}\}/g, "R$ 50.000,00").trim();
}

describe("classifyByHeuristics", () => {
  it("contrato canônico → template com confiança alta", () => {
    const res = classifyByHeuristics(CONTRATO_COMPLETO, "ccv-joao-maria.docx");
    expect(res.kind).toBe("template");
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    expect(res.reason).toContain("contrato");
  });

  it("coleção de cláusulas dos seeds → clauses", () => {
    const res = classifyByHeuristics(COLECAO_CLAUSULAS, "clausulas-vendas.docx");
    expect(res.kind).toBe("clauses");
    expect(res.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("texto corrido → knowledge", () => {
    const res = classifyByHeuristics(TEXTO_CORRIDO, "lei-inquilinato-resumo.pdf");
    expect(res.kind).toBe("knowledge");
    expect(res.confidence).toBeGreaterThanOrEqual(0.7);
    expect(res.suggestedCategory).toBe("clause");
  });

  it("knowledge com título de instrumento sugere categoria 'model'", () => {
    const res = classifyByHeuristics(
      `CONTRATO DE LOCAÇÃO RESIDENCIAL — MODELO COMENTADO\n\n${TEXTO_CORRIDO}`,
      "modelo-comentado.pdf"
    );
    expect(res.kind).toBe("knowledge");
    expect(res.suggestedCategory).toBe("model");
  });

  it("uma cláusula solta não vira coleção", () => {
    const res = classifyByHeuristics(
      `CLÁUSULA ÚNICA - DO FORO\n${stripTags(VENDAS_SEED_CLAUSES[0].content)}`,
      "clausula-foro.docx"
    );
    expect(res.kind).toBe("knowledge");
  });

  it("contrato sem fecho legível fica incerto (abaixo do limiar da IA)", () => {
    const semFecho = CONTRATO_COMPLETO.split("E por estarem")[0]
      .replace(/INSTRUMENTO PARTICULAR[^\n]*/i, "DOCUMENTO")
      .replace(/inscrit[oa] no CPF sob o nº [\d.\-]+, /gi, "");
    const res = classifyByHeuristics(semFecho, "arquivo.docx");
    expect(res.confidence).toBeLessThan(0.7);
  });

  it("é puro: nunca chama IA nem lança em texto vazio", () => {
    const res = classifyByHeuristics("", "vazio.pdf");
    expect(res.kind).toBe("knowledge");
    expect(res.via).toBe("heuristics");
  });
});

describe("collectSignals", () => {
  it("conta cabeçalhos, qualificação, fecho e título do contrato canônico", () => {
    const s = collectSignals(CONTRATO_COMPLETO, "ccv.docx");
    expect(s.clauseHeaders).toBe(4);
    expect(s.qualificationHits).toBeGreaterThanOrEqual(2);
    expect(s.closingHits).toBeGreaterThanOrEqual(1);
    expect(s.hasContractTitle).toBe(true);
    expect(s.filenameHint).toBe("template");
  });

  it("coleção de cláusulas não acusa fecho nem título", () => {
    const s = collectSignals(COLECAO_CLAUSULAS, "clausulas-vendas.docx");
    expect(s.clauseHeaders).toBe(4);
    expect(s.closingHits).toBe(0);
    expect(s.hasContractTitle).toBe(false);
    expect(s.filenameHint).toBe("clauses");
  });

  it("título de instrumento só conta no topo do documento", () => {
    const tarde = `${"prosa irrelevante. ".repeat(120)}\nINSTRUMENTO PARTICULAR DE COMPRA E VENDA`;
    expect(collectSignals(tarde, "x.pdf").hasContractTitle).toBe(false);
  });
});
