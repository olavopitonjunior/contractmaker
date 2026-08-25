import { describe, it, expect } from "vitest";
import {
  deterministicItemClassifier,
  duplicateClassification,
  externalPiiEntities,
  familyKey,
  parseItemPiiReport,
  precomputeItemSignals,
  summarizePii,
} from "@/lib/ingestion/classifier";
import type { UploadClassification } from "@/lib/knowledge/upload-classifier";
import {
  UNKNOWN_GARANTIA_KEY,
  ingestionFamilyKey,
} from "@/lib/templates/ingestion-triage";
import { detectPii } from "@/lib/ingestion/pii";

const TEMPLATE_UPLOAD: UploadClassification = {
  kind: "template",
  confidence: 0.92,
  reason: "Estrutura de contrato completo.",
};

/** Contrato de locação residencial com a garantia trocada. */
function contratoLocacao(garantia: string): string {
  return [
    "INSTRUMENTO PARTICULAR DE CONTRATO DE LOCAÇÃO RESIDENCIAL",
    "Pelo presente instrumento, de um lado a PARTE LOCADORA e de outro a PARTE LOCATÁRIA.",
    "CLÁUSULA PRIMEIRA - DO OBJETO",
    "1.1. A locação recai sobre o imóvel residencial descrito abaixo.",
    "CLÁUSULA SEGUNDA - DA GARANTIA",
    garantia,
    "E por estarem assim justos e contratados, firmam o presente em duas vias.",
  ].join("\n");
}

describe("chave de família fina", () => {
  it("monta {docType}:{modalidade}:{garantiaTipo}", () => {
    expect(
      familyKey({
        docType: "contrato_locacao",
        modalidade: "locacao",
        garantiaTipo: "fiador",
      })
    ).toBe("contrato_locacao:locacao:fiador");
  });

  it("garantia desconhecida usa o sentinela da triagem, não vira buraco", () => {
    // `sem` ≠ `sem_garantia`: "não sei qual é" e "não tem" são famílias
    // distintas — é a regra que `ingestionFamilyKey` já carrega.
    expect(
      familyKey({ docType: "contrato_locacao", modalidade: "locacao", garantiaTipo: null })
    ).toBe(`contrato_locacao:locacao:${UNKNOWN_GARANTIA_KEY}`);
    expect(
      familyKey({
        docType: "contrato_locacao",
        modalidade: "locacao",
        garantiaTipo: "sem_garantia",
      })
    ).toBe("contrato_locacao:locacao:sem_garantia");
  });

  it("sem modalidade não há família útil", () => {
    expect(familyKey({ docType: null, modalidade: null, garantiaTipo: null })).toBe(
      "-:-:-"
    );
  });

  it("é a MESMA regra da triagem client-side, com o docType na frente", () => {
    const parts = {
      docType: "contrato_locacao" as const,
      modalidade: "locacao",
      garantiaTipo: "fiador" as const,
    };
    expect(familyKey(parts)).toBe(
      `contrato_locacao:${ingestionFamilyKey({
        modalidade: parts.modalidade,
        garantia: parts.garantiaTipo,
      })}`
    );
  });

  it("GARANTIAS DISTINTAS caem em famílias distintas — nunca agrupam", () => {
    const fiador = familyKey({
      docType: "contrato_locacao",
      modalidade: "locacao",
      garantiaTipo: "fiador",
    });
    const caucao = familyKey({
      docType: "contrato_locacao",
      modalidade: "locacao",
      garantiaTipo: "caucao",
    });
    expect(fiador).not.toBe(caucao);
  });

  it("o GARANTIDOR não entra na chave — as minutas de cada seguradora agrupam", async () => {
    const porto = await deterministicItemClassifier.classify({
      filename: "locacao-porto-seguro.docx",
      text: contratoLocacao(
        "2.1. A locação é garantida por seguro fiança contratado junto à seguradora Porto Seguro, conforme apólice."
      ),
      upload: TEMPLATE_UPLOAD,
    });
    const tokio = await deterministicItemClassifier.classify({
      filename: "locacao-tokio-marine.docx",
      text: contratoLocacao(
        "2.1. A locação é garantida por seguro fiança contratado junto à seguradora Tokio Marine, conforme apólice."
      ),
      upload: TEMPLATE_UPLOAD,
    });

    expect(porto.classification.garantiaTipo).toBe("seguro_fianca");
    expect(tokio.classification.garantiaTipo).toBe("seguro_fianca");
    expect(porto.classification.familyKey).toBe(tokio.classification.familyKey);
  });

  it("residencial e comercial são famílias distintas (a modalidade entra na chave)", () => {
    const residencial = precomputeItemSignals({
      filename: "locacao-residencial.docx",
      text: contratoLocacao("2.1. A garantia é a caução prevista no artigo 38."),
      upload: TEMPLATE_UPLOAD,
    });
    const comercial = precomputeItemSignals({
      filename: "locacao-comercial.docx",
      text: [
        "CONTRATO DE LOCAÇÃO COMERCIAL (NÃO-RESIDENCIAL)",
        "Pelo presente instrumento, de um lado a PARTE LOCADORA e de outro a PARTE LOCATÁRIA.",
        "CLÁUSULA SEGUNDA - DA GARANTIA",
        "2.1. A garantia é a caução prevista no artigo 38.",
      ].join("\n"),
      upload: TEMPLATE_UPLOAD,
    });
    expect(residencial.modalidade).toBe("locacao");
    expect(comercial.modalidade).toBe("locacao_comercial");
    expect(familyKey(residencial)).not.toBe(familyKey(comercial));
  });
});

describe("classificação determinística", () => {
  it("marca de onde veio a decisão", async () => {
    const out = await deterministicItemClassifier.classify({
      filename: "contrato.docx",
      text: contratoLocacao("2.1. Garantia por fiador solidário, com renúncia ao benefício de ordem."),
      upload: TEMPLATE_UPLOAD,
    });
    expect(out.classification.via).toBe("deterministic");
    expect(out.classification.docType).toBe("contrato_locacao");
    expect(out.classification.garantiaTipo).toBe("fiador");
    expect(out.classification.confidence).toBe(0.92);
  });

  it("documento que não é contrato inteiro não ganha eixo de garantia", async () => {
    const out = await deterministicItemClassifier.classify({
      filename: "clausulas-avulsas.docx",
      text: "Cláusula de fiador. Cláusula de caução. Cláusula de multa.",
      upload: { kind: "clauses", confidence: 0.8, reason: "Coleção de cláusulas." },
    });
    expect(out.classification.docType).toBe("clausulas");
    expect(out.classification.garantiaTipo).toBeNull();
    expect(out.classification.modalidade).toBeNull();
  });

  it("é estável: o mesmo insumo produz a mesma classificação", async () => {
    const input = {
      filename: "contrato.docx",
      text: contratoLocacao("2.1. Caução em dinheiro, nos termos do artigo 38."),
      upload: TEMPLATE_UPLOAD,
    };
    const a = await deterministicItemClassifier.classify(input);
    const b = await deterministicItemClassifier.classify(input);
    expect(a).toEqual(b);
  });
});

describe("relatório de PII", () => {
  it("conta por categoria e NUNCA guarda o valor detectado", () => {
    const text =
      "O LOCATÁRIO, inscrito no CPF sob nº 111.444.777-35, e-mail joao@exemplo.com.br.";
    const report = summarizePii(detectPii(text));
    expect(report.total).toBeGreaterThan(0);
    expect(report.byKind.cpf).toBe(1);
    expect(report.maxConfidence).toBeGreaterThan(0.8);
    expect(JSON.stringify(report)).not.toContain("111.444.777-35");
    expect(JSON.stringify(report)).not.toContain("joao@exemplo.com.br");
  });

  it("texto sem PII devolve relatório zerado", () => {
    const report = summarizePii(detectPii("CLÁUSULA PRIMEIRA - DO OBJETO DA LOCAÇÃO"));
    expect(report).toEqual({ total: 0, byKind: {}, maxConfidence: 0 });
  });
});

describe("recuperação de nome e endereço pelos offsets", () => {
  const NOME = "LUCIA EXEMPLO MARTINS";
  const ENDERECO = "Avenida Imaginária, nº 12";
  const TEXTO = contratoLocacao(
    `2.1. Assina como fiadora ${NOME}, residente na ${ENDERECO}, nesta cidade.`
  );
  const ENTIDADES = [
    { kind: "person_name" as const, excerpt: NOME },
    { kind: "address" as const, excerpt: ENDERECO },
  ];

  const relatorio = () =>
    summarizePii(detectPii(TEXTO, { externalEntities: ENTIDADES }), TEXTO);

  it("o relatório guarda a POSIÇÃO, nunca o valor", () => {
    const report = relatorio();
    expect(report.byKind.person_name).toBe(1);
    expect(report.externalSpans).toHaveLength(2);
    expect(report.textFingerprint).toBeTruthy();
    expect(JSON.stringify(report)).not.toContain("LUCIA");
    expect(JSON.stringify(report)).not.toContain("Imaginária");
  });

  it("os offsets devolvem os trechos quando o texto é o mesmo", () => {
    const resolved = externalPiiEntities(TEXTO, relatorio());
    expect(resolved.trusted).toBe(true);
    expect(resolved.entities.map((e) => e.excerpt).sort()).toEqual(
      [NOME, ENDERECO].sort()
    );
  });

  it("texto reprocessado ⇒ não confiável (falha fechada para quem chama)", () => {
    const resolved = externalPiiEntities(`Cabeçalho novo.\n${TEXTO}`, relatorio());
    expect(resolved.trusted).toBe(false);
    expect(resolved.entities).toEqual([]);
  });

  it("relatório antigo, só com contagem, não é confiável", () => {
    const antigo = parseItemPiiReport({
      total: 1,
      byKind: { person_name: 1 },
      maxConfidence: 0.9,
    });
    expect(externalPiiEntities(TEXTO, antigo).trusted).toBe(false);
  });

  it("relatório antigo SEM nome nem endereço continua confiável — nada a apontar", () => {
    const antigo = parseItemPiiReport({
      total: 2,
      byKind: { cpf: 2 },
      maxConfidence: 0.99,
    });
    expect(externalPiiEntities(TEXTO, antigo)).toEqual({ entities: [], trusted: true });
  });

  it("o relatório sobrevive à ida e volta pelo JSON do banco", () => {
    const round = parseItemPiiReport(JSON.parse(JSON.stringify(relatorio())));
    expect(externalPiiEntities(TEXTO, round).trusted).toBe(true);
  });

  it("contagem e offsets discordando ⇒ não confiável", () => {
    const report = relatorio();
    const adulterado = { ...report, externalSpans: report.externalSpans!.slice(0, 1) };
    expect(externalPiiEntities(TEXTO, adulterado).trusted).toBe(false);
  });
});

describe("descarte sugerido", () => {
  it("duplicata nasce com o motivo legível e sem família útil", () => {
    const c = duplicateClassification({
      reason: "duplicate_source_hash",
      templateId: "tpl-1",
      templateName: "Locação residencial padrão",
    });
    expect(c.via).toBe("intake");
    expect(c.duplicate?.templateId).toBe("tpl-1");
    expect(c.reason).toContain("Locação residencial padrão");
    expect(c.familyKey).toBe("-:-:-");
  });
});
