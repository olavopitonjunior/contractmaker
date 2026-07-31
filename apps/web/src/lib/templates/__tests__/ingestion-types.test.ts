import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  documentTitleBlock,
  ingestDocTypesForModules,
  modalidadeForIngest,
  suggestDocType,
} from "../ingestion-types";

/**
 * O palpite "que documento é este?" da central de ingestão.
 *
 * REGRESSÃO DO QA (staging, 3 DOCX "CONTRATO DE LOCAÇÃO RESIDENCIAL QA TINY"):
 * o agrupamento e o slot funcionaram, mas o tipo veio "proposta de locação" e o
 * template nasceu na modalidade errada. Causa: a heurística usava os primeiros
 * 4.000 CARACTERES como proxy de título. Num contrato longo o corpo fica fora
 * dessa janela e o palpite acerta por acidente; num contrato CURTO a janela
 * engole o documento e qualquer menção de passagem a "proposta" numa cláusula
 * ("conforme a proposta de seguro") decidia o tipo.
 *
 * Agora o TÍTULO manda, e o corpo só decide quando o título é mudo.
 */

const TINY_CONTRATO = `CONTRATO DE LOCAÇÃO PARA FINS RESIDENCIAIS

LOCADOR: JOÃO LOCADOR TESTE, brasileiro, casado, inscrito no CPF sob nº. 111.222.333-96.
LOCATÁRIO: CARLOS LOCATÁRIO TESTE, brasileiro, casado, inscrito no CPF sob nº. 333.444.555-08.

Cláusula primeira: O LOCADOR entrega em locação o imóvel pelo prazo de 30 (trinta) meses.
Cláusula segunda: O valor do aluguel mensal é de R$ 2.500,00, reajustado anualmente pelo IGP-M.
Cláusula terceira: A garantia é o seguro de fiança locatícia, conforme a proposta de seguro protocolada junto à seguradora.
Cláusula quarta: A rescisão antecipada sujeita o infrator à multa de três aluguéis.
Cláusula quinta: Para todas as questões será competente o foro da situação do imóvel.

E por estarem assim justos e contratados, firmam o presente em duas vias de igual teor.

TESTEMUNHAS:`;

function suggest(filename: string, text: string) {
  return suggestDocType({ classificationKind: "template", filename, text });
}

describe("documentTitleBlock", () => {
  it("pega as primeiras linhas com conteúdo, ignorando as vazias", () => {
    expect(documentTitleBlock("\n\n  CONTRATO DE LOCAÇÃO  \n\nLOCADOR: X")).toBe(
      "contrato de locação\nlocador: x"
    );
  });

  it("não deixa o corpo entrar no título", () => {
    const t = documentTitleBlock(TINY_CONTRATO);
    expect(t).toContain("contrato de locação");
    expect(t).not.toContain("proposta");
  });
});

describe("suggestDocType — REGRESSÃO do QA", () => {
  it("contrato CURTO que cita 'proposta' numa cláusula continua sendo CONTRATO", () => {
    const s = suggest("CONTRATO-LOCACAO-RESIDENCIAL-QA-TINY.docx", TINY_CONTRATO);
    expect(s.type).toBe("contrato_locacao");
    expect(s.subOption).toBe("residencial");
    expect(modalidadeForIngest(s.type, s.subOption)).toBe("locacao");
  });

  it("o motivo diz que o palpite veio do TÍTULO (o operador sabe o quanto confiar)", () => {
    expect(suggest("x.docx", TINY_CONTRATO).reason).toMatch(/t[íi]tulo do documento/i);
    expect(
      suggest("x.docx", TINY_CONTRATO.split("\n").slice(2).join("\n")).reason
    ).toMatch(/o texto indica/i);
  });

  it("sem título, o fecho de assinaturas + rescisão desempatam a favor do CONTRATO", () => {
    // Regra 2: proposta é oferta — não rescinde nem se assina em duas vias.
    const semTitulo = TINY_CONTRATO.split("\n").slice(2).join("\n");
    expect(documentTitleBlock(semTitulo)).not.toContain("contrato");
    expect(suggest("qa.docx", semTitulo).type).toBe("contrato_locacao");
  });

  it("'CONTRATO' vence quando aparece ANTES de 'proposta' no próprio título", () => {
    const s = suggest(
      "x.docx",
      "CONTRATO DE LOCAÇÃO RESIDENCIAL — conforme proposta aceita\n\nO LOCADOR entrega o imóvel."
    );
    expect(s.type).toBe("contrato_locacao");
  });
});

describe("suggestDocType — casos que NÃO podem regredir", () => {
  it.each([
    [
      "PROPOSTA DE LOCAÇÃO RESIDENCIAL\n\nO proponente oferece R$ 2.000,00 mensais pelo imóvel.",
      "proposta_locacao",
      "proposta_locacao_residencial",
    ],
    [
      "PROPOSTA DE LOCAÇÃO NÃO RESIDENCIAL\n\nO proponente oferece R$ 9.000,00 pela sala comercial.",
      "proposta_locacao",
      "proposta_locacao_comercial",
    ],
    [
      "PROPOSTA DE COMPRA DE IMÓVEL\n\nO proponente oferece ao vendedor R$ 500.000,00.",
      "proposta_venda",
      "proposta_venda",
    ],
    [
      "CONTRATO DE ADMINISTRAÇÃO DE LOCAÇÃO\n\nO CONTRATANTE nomeia a CONTRATADA como administradora.",
      "contrato_administracao",
      "administracao_locacao",
    ],
    [
      "CONTRATO DE LOCAÇÃO NÃO RESIDENCIAL\n\nO LOCADOR entrega o imóvel comercial ao LOCATÁRIO.",
      "contrato_locacao",
      "locacao_comercial",
    ],
    [
      "INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA\n\nO VENDEDOR vende ao COMPRADOR o imóvel, à vista.",
      "contrato_venda",
      "a_vista",
    ],
    [
      "INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA\n\nO COMPRADOR pagará mediante financiamento bancário com alienação fiduciária.",
      "contrato_venda",
      "financiamento",
    ],
  ])("%s#", (text, type, modalidade) => {
    const s = suggest("doc.docx", text);
    expect(s.type).toBe(type);
    expect(modalidadeForIngest(s.type, s.subOption)).toBe(modalidade);
  });

  it("os 4 contratos reais da Ativa continuam sendo contrato de locação residencial", () => {
    const DIR = join(__dirname, "fixtures", "ativa-residencial");
    for (const f of [
      "01-RES-FIADOR.txt",
      "02-RES-SEM-FIANCA.txt",
      "03-RES-PORTO-SEGURO.txt",
      "04-RES-TITULO-CAPITALIZACAO.txt",
    ]) {
      const s = suggest(f, readFileSync(join(DIR, f), "utf8"));
      expect(s.type, f).toBe("contrato_locacao");
      expect(modalidadeForIngest(s.type, s.subOption), f).toBe("locacao");
    }
  });

  it("classificação não-template continua caindo em cláusulas avulsas", () => {
    expect(
      suggestDocType({
        classificationKind: "clauses",
        filename: "clausulas.docx",
        text: TINY_CONTRATO,
      }).type
    ).toBe("clausulas");
    expect(
      suggestDocType({
        classificationKind: "knowledge",
        filename: "lei.pdf",
        text: "LEI Nº 8.245",
      }).type
    ).toBe("clausulas");
  });
});

describe("filtro por módulos habilitados", () => {
  it("org só-locação não vê os tipos de venda", () => {
    const keys = ingestDocTypesForModules(["locacao"]).map((d) => d.key);
    expect(keys).toEqual(
      expect.arrayContaining(["contrato_locacao", "proposta_locacao", "clausulas"])
    );
    expect(keys).not.toContain("contrato_venda");
    expect(keys).not.toContain("proposta_venda");
  });

  it("cláusulas avulsas aparecem mesmo sem módulo nenhum", () => {
    expect(ingestDocTypesForModules([]).map((d) => d.key)).toEqual(["clausulas"]);
  });
});
