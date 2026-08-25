import { describe, it, expect } from "vitest";
import {
  buildConsolidationPlan,
  buildDifferenceMatrix,
  DEFAULT_SIMILARITY_THRESHOLD,
  groupSimilarDocs,
  lcsKeys,
  normalizeDoc,
  paragraphKey,
  primaryDifferenceRow,
  similarity,
  suggestGarantiaTipo,
  toParagraphs,
} from "../consolidation";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures: 3 contratos de locação IDÊNTICOS exceto pela cláusula de garantia —
// exatamente o caso real (a imobiliária guarda "com fiador", "com caução" e
// "com seguro-fiança" como três arquivos).
// ────────────────────────────────────────────────────────────────────────────

const PREAMBULO = [
  "INSTRUMENTO PARTICULAR DE CONTRATO DE LOCAÇÃO RESIDENCIAL",
  "Pelo presente instrumento particular de contrato de locação, de um lado, como LOCADOR(A) e doravante nomeada PARTE LOCADORA, {{locadores_qualificacao}}, e de outro lado, como LOCATÁRIO(A), {{locatarios_qualificacao}}, têm entre si justo e acertado o seguinte:",
  "CLÁUSULA PRIMEIRA - DO OBJETO",
  "1.1. O objeto do presente contrato é a locação do imóvel situado em {{imovel_endereco}}, destinado exclusivamente a fins residenciais.",
  "CLÁUSULA SEGUNDA - DO PRAZO",
  "2.1. A presente locação é celebrada pelo prazo de {{aluguel_prazo_meses}} meses, iniciando-se em {{aluguel_data_inicio}}.",
  "CLÁUSULA TERCEIRA - DO ALUGUEL",
  "3.1. O aluguel mensal é de {{aluguel_valor}}, a ser pago até o dia {{aluguel_dia_vencimento}} de cada mês vencido.",
  "CLÁUSULA QUARTA - DOS ENCARGOS",
  "4.1. Correrão por conta da PARTE LOCATÁRIA as despesas de condomínio, IPTU, água, luz e gás do imóvel locado.",
  "CLÁUSULA QUINTA - DA CONSERVAÇÃO",
  "5.1. A PARTE LOCATÁRIA receberá o imóvel em perfeito estado de conservação e assim deverá restituí-lo ao final da locação.",
  "CLÁUSULA SEXTA - DAS BENFEITORIAS",
  "6.1. As benfeitorias necessárias serão indenizadas; as úteis e voluptuárias, ainda que autorizadas, não darão direito a retenção.",
  "CLÁUSULA SÉTIMA - DA MULTA",
  "7.1. A infração de qualquer cláusula deste contrato sujeita o infrator ao pagamento de multa equivalente a três aluguéis vigentes.",
  "CLÁUSULA OITAVA - DA GARANTIA",
];

const FECHO = [
  "CLÁUSULA NONA - DO FORO",
  "9.1. Fica eleito o foro da comarca do imóvel para dirimir quaisquer questões oriundas do presente contrato.",
  "E por estarem assim justos e contratados, firmam o presente em duas vias de igual teor e forma.",
  "____________________________________________ PARTE LOCADORA",
  "____________________________________________ PARTE LOCATÁRIA",
];

const GARANTIA_FIADOR = [
  "8.1. Para garantir as obrigações assumidas neste contrato, o(a) FIADOR(A) qualificado(a) no preâmbulo assume responsabilidade solidária com a PARTE LOCATÁRIA, com expressa renúncia ao benefício de ordem, respondendo até a efetiva entrega das chaves.",
];

const GARANTIA_CAUCAO = [
  "8.1. Para garantir as obrigações assumidas neste contrato, a PARTE LOCATÁRIA dá neste ato, a título de caução, o equivalente a três aluguéis, nos termos do art. 38 da Lei nº 8.245/91, a ser restituído ao final da locação.",
];

const GARANTIA_SEGURO = [
  "8.1. Para garantir as obrigações assumidas neste contrato, a locação é garantida por seguro de fiança locatícia contratado junto a seguradora idônea, cujas condições e apólice integram este contrato.",
  "8.2. A PARTE LOCATÁRIA obriga-se a manter a apólice vigente durante todo o prazo da locação, renovando-a com antecedência mínima de trinta dias.",
];

function docText(garantia: string[]): string {
  return [...PREAMBULO, ...garantia, ...FECHO].join("\n");
}

const DOCS = [
  { id: "a", name: "locacao-fiador.docx", text: docText(GARANTIA_FIADOR) },
  { id: "b", name: "locacao-caucao.docx", text: docText(GARANTIA_CAUCAO) },
  { id: "c", name: "locacao-seguro.docx", text: docText(GARANTIA_SEGURO) },
].map((d) => normalizeDoc({ ...d, family: "locacao" }));

describe("normalização", () => {
  it("paragraphKey ignora caixa, acento, pontuação e espaço duplo", () => {
    expect(paragraphKey("CLÁUSULA  PRIMEIRA — DO OBJETO.")).toBe(
      paragraphKey("cláusula primeira - do objeto")
    );
  });

  it("paragraphKey PRESERVA número (8.1 ≠ 9.1 é diferença real)", () => {
    expect(paragraphKey("8.1. Da garantia locatícia")).not.toBe(
      paragraphKey("9.1. Da garantia locatícia")
    );
  });

  it("toParagraphs descarta linhas vazias e ruído curto", () => {
    const out = toParagraphs("Título\n\n   \nUm parágrafo com conteúdo suficiente.\nok\n");
    expect(out).toEqual(["Um parágrafo com conteúdo suficiente."]);
  });
});

describe("lcsKeys / similarity", () => {
  it("LCS de sequências iguais é a própria sequência", () => {
    expect(lcsKeys(["a", "b", "c"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("LCS preserva a ordem e ignora os itens exclusivos", () => {
    expect(lcsKeys(["a", "x", "b", "c"], ["a", "b", "y", "c"])).toEqual(["a", "b", "c"]);
  });

  it("documentos sem nada em comum têm similaridade 0", () => {
    const x = normalizeDoc({ id: "x", name: "x", text: "Um texto completamente distinto." });
    const y = normalizeDoc({ id: "y", name: "y", text: "Outro assunto sem relação alguma." });
    expect(similarity(x, y)).toBe(0);
  });

  it("as 3 variantes de garantia ficam acima do limiar de agrupamento", () => {
    expect(similarity(DOCS[0], DOCS[1])).toBeGreaterThan(DEFAULT_SIMILARITY_THRESHOLD);
    expect(similarity(DOCS[0], DOCS[2])).toBeGreaterThan(DEFAULT_SIMILARITY_THRESHOLD);
  });
});

describe("groupSimilarDocs", () => {
  it("junta as 3 variantes num grupo só", () => {
    const groups = groupSimilarDocs(DOCS);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds.sort()).toEqual(["a", "b", "c"]);
    expect(groups[0].id).toBe("a");
    expect(groups[0].minSimilarity).toBeGreaterThan(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it("um documento de outra natureza NÃO entra no grupo", () => {
    const outro = normalizeDoc({
      id: "d",
      name: "administracao.docx",
      family: "locacao",
      text: [
        "CONTRATO DE ADMINISTRAÇÃO DE LOCAÇÃO DE IMÓVEL",
        "O CONTRATANTE nomeia a CONTRATADA como sua administradora para os fins deste instrumento.",
        "A taxa de administração é de dez por cento sobre os valores efetivamente recebidos.",
        "O presente contrato vigorará por prazo indeterminado a partir da assinatura.",
      ].join("\n"),
    });
    const groups = groupSimilarDocs([...DOCS, outro]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).not.toContain("d");
  });

  it("famílias diferentes nunca agrupam, mesmo com texto idêntico", () => {
    const contrato = normalizeDoc({
      id: "a",
      name: "locacao-fiador.docx",
      family: "locacao",
      text: docText(GARANTIA_FIADOR),
    });
    const proposta = normalizeDoc({
      id: "p",
      name: "proposta.docx",
      family: "proposta_locacao_residencial",
      text: docText(GARANTIA_FIADOR),
    });
    expect(groupSimilarDocs([contrato, proposta])).toHaveLength(0);
  });

  it("documento sozinho não vira grupo (segue o caminho simples)", () => {
    expect(groupSimilarDocs([DOCS[0]])).toHaveLength(0);
  });
});

describe("buildConsolidationPlan", () => {
  const plan = buildConsolidationPlan(DOCS);

  it("a base comum contém preâmbulo e fecho, e NÃO contém as cláusulas de garantia", () => {
    const joined = plan.commonParagraphs.join("\n");
    expect(joined).toContain("CLÁUSULA PRIMEIRA - DO OBJETO");
    expect(joined).toContain("CLÁUSULA OITAVA - DA GARANTIA");
    expect(joined).toContain("9.1. Fica eleito o foro");
    expect(joined).not.toContain("benefício de ordem");
    expect(joined).not.toContain("a título de caução");
    expect(joined).not.toContain("seguro de fiança locatícia");
  });

  it("a base comum tem exatamente os parágrafos compartilhados", () => {
    expect(plan.commonParagraphs).toHaveLength(PREAMBULO.length + FECHO.length);
  });

  it("cada variante isola só o próprio bloco divergente", () => {
    const byDoc = Object.fromEntries(plan.variants.map((v) => [v.docId, v]));
    expect(byDoc.a.divergentCount).toBe(1);
    expect(byDoc.b.divergentCount).toBe(1);
    expect(byDoc.c.divergentCount).toBe(2);
    expect(byDoc.a.blocks[0].paragraphs[0]).toContain("benefício de ordem");
    expect(byDoc.c.blocks[0].paragraphs[1]).toContain("apólice vigente");
  });

  it("os blocos divergentes ancoram na MESMA posição da base comum", () => {
    const anchors = plan.variants.map((v) => v.blocks[0].anchorIndex);
    expect(new Set(anchors).size).toBe(1);
    expect(anchors[0]).toBe(PREAMBULO.length);
  });

  it("o documento de referência é o primeiro recebido", () => {
    expect(plan.referenceDocId).toBe("a");
  });

  it("um documento só: tudo é base comum, nada é divergência", () => {
    const single = buildConsolidationPlan([DOCS[0]]);
    expect(single.variants[0].divergentCount).toBe(0);
    expect(single.commonParagraphs).toHaveLength(DOCS[0].paragraphs.length);
  });

  it("lista vazia é erro de programação, não silêncio", () => {
    expect(() => buildConsolidationPlan([])).toThrow(/vazia/i);
  });
});

describe("buildDifferenceMatrix / primaryDifferenceRow", () => {
  const plan = buildConsolidationPlan(DOCS);
  const matrix = buildDifferenceMatrix(plan);

  it("uma linha por posição divergente, com as 3 variantes lado a lado", () => {
    expect(matrix).toHaveLength(1);
    expect(Object.keys(matrix[0].byDoc).sort()).toEqual(["a", "b", "c"]);
  });

  it("a linha primária é a de maior conteúdo", () => {
    const primary = primaryDifferenceRow(matrix);
    expect(primary?.anchorIndex).toBe(PREAMBULO.length);
    expect(primary?.byDoc.b[0]).toContain("caução");
  });

  it("sem divergência não há linha primária", () => {
    expect(primaryDifferenceRow([])).toBeNull();
  });
});

describe("suggestGarantiaTipo (palpite determinístico do rótulo)", () => {
  it.each([
    [GARANTIA_FIADOR.join(" "), "fiador"],
    [GARANTIA_CAUCAO.join(" "), "caucao"],
    [GARANTIA_SEGURO.join(" "), "seguro_fianca"],
    [
      "dá em caução o Título de Capitalização subscrito pela Sociedade de Capitalização",
      "titulo_capitalizacao",
    ],
    [
      "As partes ajustam a presente locação sem modalidade de garantia, nos termos do art. 37.",
      "sem_garantia",
    ],
    // Garantia ONEROSA — reconhecida pelas palavras da MODALIDADE. Nenhum nome
    // de fornecedor entra na heurística: a lista (Almada, Loft, CredAluga…)
    // varia por imobiliária e amarrá-la ao palpite quebraria em toda troca.
    [
      "A locação é garantida por garantia onerosa prestada pela garantidora, na forma do respectivo termo de adesão.",
      "garantia_onerosa",
    ],
    [
      "A PARTE LOCATÁRIA contratou fiança digital junto à empresa garantidora indicada pela administradora.",
      "garantia_onerosa",
    ],
    [
      "A garantia da presente locação se dará por carta de fiança emitida em favor da PARTE LOCADORA.",
      "garantia_onerosa",
    ],
  ])("reconhece %s#", (text, expected) => {
    expect(suggestGarantiaTipo(text)).toBe(expected);
  });

  it("devolve null quando nenhuma palavra-chave aparece", () => {
    expect(suggestGarantiaTipo("O imóvel será entregue pintado e sem avarias.")).toBeNull();
  });
});
