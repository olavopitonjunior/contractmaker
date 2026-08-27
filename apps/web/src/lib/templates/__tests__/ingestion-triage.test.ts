import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groupSimilarDocs, normalizeDoc, similarity } from "../consolidation";
import { MIN_SLOT_BLOCK_CHARS } from "../apply-clause-slot";
import { slugifyProviderTag } from "../clause-slots";
import {
  collidingVariantValues,
  consolidatedMatchCriteria,
  garantiaExcerpts,
  garantiaSlotCandidate,
  guessDocumentGarantia,
  ingestionFamilyKey,
  MIN_SLOT_PARAGRAPH_CHARS,
  normalizeProviderKey,
  parseSlotReports,
  slotFailureMessage,
  suggestProviderName,
  UNKNOWN_GARANTIA_KEY,
} from "../ingestion-triage";

/**
 * As decisões da triagem contra o corpus REAL da Ativa (os mesmos 4 contratos
 * residenciais higienizados de `consolidation-corpus.test.ts`) e contra os dois
 * casos que definem a regra de produto:
 *
 *   fiador × caução  → NUNCA agrupam (garantias diferentes = contratos
 *                      diferentes), por mais idêntico que seja o resto do texto;
 *   4 fornecedores   → agrupam (mesma garantia; o que muda vira cláusula do
 *   da mesma garantia   acervo com tag `provider:<slug>`).
 */

const DIR = join(__dirname, "fixtures", "ativa-residencial");
const read = (file: string) => readFileSync(join(DIR, file), "utf8");

const FIADOR = read("01-RES-FIADOR.txt");
const SEM_FIANCA = read("02-RES-SEM-FIANCA.txt");
const PORTO_SEGURO = read("03-RES-PORTO-SEGURO.txt");
const TITULO = read("04-RES-TITULO-CAPITALIZACAO.txt");

describe("ingestionFamilyKey", () => {
  it("junta modalidade e garantia — é a chave que separa fiador de caução", () => {
    expect(ingestionFamilyKey({ modalidade: "locacao", garantia: "fiador" })).toBe(
      "locacao:fiador"
    );
    expect(ingestionFamilyKey({ modalidade: "locacao", garantia: "caucao" })).toBe(
      "locacao:caucao"
    );
  });

  it("sem modalidade não há família (o arquivo nem vira modelo)", () => {
    expect(ingestionFamilyKey({ modalidade: null, garantia: "fiador" })).toBeNull();
  });

  it("garantia desconhecida vira a chave própria, distinta de sem_garantia", () => {
    expect(ingestionFamilyKey({ modalidade: "locacao", garantia: null })).toBe(
      `locacao:${UNKNOWN_GARANTIA_KEY}`
    );
    expect(
      ingestionFamilyKey({ modalidade: "locacao", garantia: "sem_garantia" })
    ).not.toBe(`locacao:${UNKNOWN_GARANTIA_KEY}`);
  });

  it("normaliza o valor legado (garantia_digital → garantia_onerosa)", () => {
    expect(
      ingestionFamilyKey({ modalidade: "locacao", garantia: "garantia_digital" })
    ).toBe("locacao:garantia_onerosa");
  });
});

describe("guessDocumentGarantia — corpus Ativa", () => {
  it("acerta as três garantias declaradas", () => {
    expect(guessDocumentGarantia(FIADOR)).toBe("fiador");
    expect(guessDocumentGarantia(PORTO_SEGURO)).toBe("seguro_fianca");
    expect(guessDocumentGarantia(TITULO)).toBe("titulo_capitalizacao");
  });

  it("contrato sem cláusula de garantia não recebe palpite", () => {
    expect(guessDocumentGarantia(SEM_FIANCA)).toBeNull();
  });

  it("REGRESSÃO: o seguro contra incêndio não faz todo contrato virar seguro-fiança", () => {
    // Os 4 arquivos têm a cláusula "apólice do seguro contra incêndio". Ela é
    // obrigação do locatário, não garantia locatícia — e `suggestGarantiaTipo`
    // aplicado ao documento inteiro responderia `seguro_fianca` pra todos.
    expect(FIADOR).toMatch(/APÓLICE DO SEGURO CONTRA INCÊNDIO/i);
    for (const excerpt of garantiaExcerpts(FIADOR)) {
      expect(excerpt.paragraphs.join("\n")).not.toMatch(/incêndio/i);
    }
  });
});

describe("agrupamento com a família fina", () => {
  /** O mesmo contrato, com uma cláusula de garantia diferente no fim. */
  const withClause = (clause: string) => `${SEM_FIANCA}\n\n${clause}`;

  const CLAUSULA_FIADOR =
    "Cláusula décima quinta: ASSINA ESTE CONTRATO NA CONDIÇÃO DE FIADOR E DEVEDOR " +
    "SOLIDÁRIO COM O LOCATÁRIO, POR TODAS AS OBRIGAÇÕES POR ESTE ASSUMIDAS, " +
    "renunciando ao benefício de ordem previsto no artigo 827 do Código Civil.";
  const CLAUSULA_CAUCAO =
    "Cláusula décima quinta: Como garantia da presente locação, o LOCATÁRIO entrega " +
    "neste ato caução em dinheiro equivalente a 3 (três) aluguéis, depositada em " +
    "caderneta de poupança na forma do artigo 38 da Lei nº 8.245/1991.";

  const docFor = (id: string, text: string) =>
    normalizeDoc({
      id,
      name: `${id}.docx`,
      text,
      family: ingestionFamilyKey({
        modalidade: "locacao",
        garantia: guessDocumentGarantia(text),
      }),
    });

  it("fiador × caução NÃO agrupam, mesmo sendo quase o mesmo texto", () => {
    const fiador = docFor("fiador", withClause(CLAUSULA_FIADOR));
    const caucao = docFor("caucao", withClause(CLAUSULA_CAUCAO));

    expect(fiador.family).toBe("locacao:fiador");
    expect(caucao.family).toBe("locacao:caucao");
    // A prova de que é a FAMÍLIA que separa, e não a distância dos textos: com a
    // chave grossa (só a modalidade) os dois formariam uma base só.
    expect(similarity(fiador, caucao)).toBeGreaterThan(0.9);
    expect(
      groupSimilarDocs([
        { ...fiador, family: "locacao" },
        { ...caucao, family: "locacao" },
      ])
    ).toHaveLength(1);

    expect(groupSimilarDocs([fiador, caucao])).toHaveLength(0);
  });

  it("os 4 contratos reais da Ativa deixam de virar uma base só", () => {
    const docs = [
      docFor("fiador", FIADOR),
      docFor("semFianca", SEM_FIANCA),
      docFor("portoSeguro", PORTO_SEGURO),
      docFor("titulo", TITULO),
    ];
    expect(new Set(docs.map((d) => d.family)).size).toBe(4);
    expect(groupSimilarDocs(docs)).toHaveLength(0);
  });

  it("os 4 fornecedores da MESMA garantia continuam agrupando", () => {
    // Só o nome da seguradora muda — é o caso em que consolidar é correto: a
    // base é uma só e a diferença vira cláusula com tag `provider:<slug>`.
    const providers = ["PORTO SEGURO", "TOKIO MARINE", "POTTENCIAL", "TOO SEGUROS"];
    const docs = providers.map((p) =>
      docFor(p, PORTO_SEGURO.replace(/PORTO SEGURO/g, p).replace(/Porto Seguro/g, p))
    );

    for (const doc of docs) expect(doc.family).toBe("locacao:seguro_fianca");
    const groups = groupSimilarDocs(docs);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toHaveLength(4);
  });
});

describe("garantiaSlotCandidate", () => {
  it("isola a cláusula de garantia do arquivo avulso", () => {
    const candidate = garantiaSlotCandidate(TITULO);
    expect(candidate).not.toBeNull();
    expect(candidate!.paragraphs.join("\n")).toMatch(/T[ÍI]TULO DE CAPITALIZA[ÇC][ÃA]O/i);
  });

  it("o bloco oferecido passa nas guardas do servidor (tamanho e unicidade)", () => {
    for (const text of [FIADOR, PORTO_SEGURO, TITULO]) {
      const candidate = garantiaSlotCandidate(text)!;
      expect(candidate.paragraphs.length).toBeGreaterThan(0);
      for (const p of candidate.paragraphs) {
        expect(p.length).toBeGreaterThanOrEqual(MIN_SLOT_PARAGRAPH_CHARS);
        expect(text.split(p).length - 1).toBe(1);
      }
    }
  });

  it("o piso local acompanha o do servidor", () => {
    expect(MIN_SLOT_PARAGRAPH_CHARS).toBe(MIN_SLOT_BLOCK_CHARS);
  });

  it("contrato sem cláusula de garantia não oferece bloco nenhum", () => {
    expect(garantiaSlotCandidate(SEM_FIANCA)).toBeNull();
  });
});

describe("garantidor da variante", () => {
  it("normaliza igual ao servidor (a tag do acervo tem que casar)", () => {
    for (const label of ["Porto Seguro", "TOKIO MARINE", "Pottencial", "Too", "  "]) {
      expect(normalizeProviderKey(label)).toBe(slugifyProviderTag(label));
    }
  });

  it("reconhece as seguradoras do catálogo padrão no texto da variante", () => {
    expect(suggestProviderName(PORTO_SEGURO)).toBe("Porto Seguro");
    expect(suggestProviderName("cláusula com a TOKIO MARINE SEGURADORA S.A.")).toBe(
      "Tokio Marine"
    );
    expect(suggestProviderName(FIADOR)).toBeNull();
  });

  it("acusa as variantes que o servidor recusaria (mesma garantia, mesmo fornecedor)", () => {
    // É o caso que a família fina tornou comum: 4 minutas de seguro-fiança.
    expect(
      collidingVariantValues([
        { value: "seguro_fianca", provider: "Porto Seguro" },
        { value: "seguro_fianca", provider: "Tokio Marine" },
      ])
    ).toEqual([]);
    expect(
      collidingVariantValues([
        { value: "seguro_fianca" },
        { value: "seguro_fianca", provider: "  " },
      ])
    ).toEqual(["seguro_fianca"]);
    expect(
      collidingVariantValues([
        { value: "seguro_fianca", provider: "porto seguro" },
        { value: "seguro_fianca", provider: "Porto Seguro" },
      ])
    ).toEqual(["seguro_fianca"]);
  });
});

describe("consolidatedMatchCriteria", () => {
  it("amarra o modelo à garantia rotulada nas variantes", () => {
    expect(
      consolidatedMatchCriteria({
        familyGarantia: "seguro_fianca",
        variantValues: ["seguro_fianca", "seguro_fianca", "seguro_fianca"],
        memberCriteria: [{}, {}, {}],
      })
    ).toEqual({ garantia: "seguro_fianca" });
  });

  it("sem rótulo nenhum, cai na garantia da família (o palpite da triagem)", () => {
    expect(
      consolidatedMatchCriteria({
        familyGarantia: "fiador",
        variantValues: [null, undefined],
        memberCriteria: [{}, {}],
      })
    ).toEqual({ garantia: "fiador" });
  });

  it("variantes rotuladas com garantias diferentes deixam o modelo genérico", () => {
    // Marcar uma delas desclassificaria o modelo no formulário que escolhesse
    // a outra — pior do que não marcar nada.
    expect(
      consolidatedMatchCriteria({
        familyGarantia: "fiador",
        variantValues: ["fiador", "caucao"],
        memberCriteria: [{}, {}],
      })
    ).toEqual({});
  });

  it("normaliza o valor legado gravado na triagem", () => {
    expect(
      consolidatedMatchCriteria({
        familyGarantia: null,
        variantValues: ["garantia_digital", "garantia_onerosa"],
        memberCriteria: [{}, {}],
      })
    ).toEqual({ garantia: "garantia_onerosa" });
  });

  it("aproveita os outros eixos quando TODOS os membros declaram o mesmo", () => {
    expect(
      consolidatedMatchCriteria({
        familyGarantia: "fiador",
        variantValues: ["fiador", "fiador"],
        memberCriteria: [
          { fiadorPessoa: "pf", admImobiliaria: "true", pessoa: "pf" },
          { fiadorPessoa: "pf", admImobiliaria: "true", pessoa: "pj" },
        ],
      })
    ).toEqual({
      garantia: "fiador",
      fiadorPessoa: "pf",
      admImobiliaria: "true",
    });
  });

  it("um membro em 'Qualquer' mantém o eixo fora do critério", () => {
    expect(
      consolidatedMatchCriteria({
        familyGarantia: "fiador",
        variantValues: ["fiador"],
        memberCriteria: [{ pessoa: "pf" }, {}],
      })
    ).toEqual({ garantia: "fiador" });
  });
});

describe("relato da falha do slot", () => {
  it("traduz o motivo e diz o que sobrou no modelo", () => {
    const reports = parseSlotReports([
      { slot: "garantia", applied: false, issues: [{ reason: "ambiguous", paragraph: "…" }] },
    ]);
    expect(reports).toEqual([
      { slot: "garantia", applied: false, reasons: ["ambiguous"] },
    ]);
    expect(slotFailureMessage(reports)).toContain("aparece mais de uma vez");
    expect(slotFailureMessage(reports)).toContain("cláusula fixa");
  });

  it("slot aplicado não vira mensagem", () => {
    expect(
      slotFailureMessage(parseSlotReports([{ slot: "garantia", applied: true, issues: [] }]))
    ).toBeNull();
  });

  it("resposta sem `slots` (rota antiga) não quebra nem inventa falha", () => {
    expect(parseSlotReports(undefined)).toEqual([]);
    expect(slotFailureMessage([])).toBeNull();
  });

  it("motivo desconhecido é descartado, mas a falha continua sendo anunciada", () => {
    const reports = parseSlotReports([
      { slot: "garantia", applied: false, issues: [{ reason: "vixe" }] },
    ]);
    expect(reports[0].reasons).toEqual([]);
    expect(slotFailureMessage(reports)).toContain("não foi aberto");
  });
});
