import { describe, it, expect, vi, beforeEach } from "vitest";

const batchUpdateDocMock = vi.fn();
const getDocPlainTextMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  batchUpdateDoc: (...args: unknown[]) => batchUpdateDocMock(...args),
  getDocPlainText: (...args: unknown[]) => getDocPlainTextMock(...args),
}));

import {
  applyClauseSlotToDoc,
  countOccurrences,
  MIN_SLOT_BLOCK_CHARS,
  normalizeForSlotMatch,
  resolveBlockLiteral,
} from "../apply-clause-slot";

const CLAUSULA_A =
  "8.1. Para garantir as obrigações assumidas neste contrato, o FIADOR assume responsabilidade solidária com a PARTE LOCATÁRIA, com renúncia ao benefício de ordem.";
const CLAUSULA_B =
  "8.2. A fiança perdura até a efetiva entrega das chaves, ainda que a locação se prorrogue por prazo indeterminado.";

function docWith(...parts: string[]): string {
  return [
    "CONTRATO DE LOCAÇÃO RESIDENCIAL",
    "CLÁUSULA OITAVA - DA GARANTIA",
    ...parts,
    "CLÁUSULA NONA - DO FORO",
  ].join("\n");
}

const requestsOf = () => batchUpdateDocMock.mock.calls[0]?.[1] ?? [];

/** Resposta do batchUpdate: uma reply por request, todas casando 1 ocorrência. */
function batchOk(n: number) {
  return {
    data: {
      replies: Array.from({ length: n }, () => ({
        replaceAllText: { occurrencesChanged: 1 },
      })),
    },
  };
}

/**
 * Simula o doc ANTES (guarda determinística) e DEPOIS (verificação) do batch:
 * a releitura devolve o texto com o bloco trocado pelo token.
 */
function docBeforeAndAfter(before: string, after: string) {
  getDocPlainTextMock
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(after);
}

describe("countOccurrences", () => {
  it("conta ocorrências exatas, inclusive sobrepostas na busca linear", () => {
    expect(countOccurrences("abcabc", "abc")).toBe(2);
    expect(countOccurrences("abc", "xyz")).toBe(0);
    expect(countOccurrences("abc", "")).toBe(0);
  });
});

describe("applyClauseSlotToDoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchUpdateDocMock.mockResolvedValue(batchOk(2));
    getDocPlainTextMock.mockResolvedValue(docWith(CLAUSULA_A, CLAUSULA_B));
  });

  it("troca o 1º parágrafo pelo token e esvazia os demais", async () => {
    docBeforeAndAfter(
      docWith(CLAUSULA_A, CLAUSULA_B),
      docWith("{{slot_garantia}}")
    );
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A, CLAUSULA_B],
    });

    expect(report).toMatchObject({
      slot: "garantia",
      applied: true,
      token: "{{slot_garantia}}",
      removed: 1,
      issues: [],
    });
    expect(requestsOf()).toEqual([
      {
        replaceAllText: {
          containsText: { text: CLAUSULA_A, matchCase: true },
          replaceText: "{{slot_garantia}}",
        },
      },
      {
        replaceAllText: {
          containsText: { text: CLAUSULA_B, matchCase: true },
          replaceText: "",
        },
      },
    ]);
  });

  it("bloco de um parágrafo só: token entra, nada é removido", async () => {
    batchUpdateDocMock.mockResolvedValue(batchOk(1));
    docBeforeAndAfter(docWith(CLAUSULA_A), docWith("{{slot_garantia}}"));
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });
    expect(report.applied).toBe(true);
    expect(report.removed).toBe(0);
  });

  it("REGRESSÃO (F2): texto repetido no doc NÃO é substituído — replaceAllText é global", async () => {
    // O mesmo parágrafo aparece de novo num "resumo executivo" no fim do doc.
    getDocPlainTextMock.mockResolvedValue(
      `${docWith(CLAUSULA_A)}\nRESUMO\n${CLAUSULA_A}`
    );
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });

    expect(report.applied).toBe(false);
    expect(report.token).toBeNull();
    expect(report.issues).toEqual([
      { paragraph: CLAUSULA_A.slice(0, 200), reason: "ambiguous" },
    ]);
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("trecho ausente do doc não aplica nada", async () => {
    getDocPlainTextMock.mockResolvedValue(docWith(CLAUSULA_B));
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });
    expect(report.applied).toBe(false);
    expect(report.issues[0].reason).toBe("not-found");
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("parágrafo curto demais é recusado antes mesmo de contar ocorrências", async () => {
    const curto = "Parágrafo único.";
    expect(curto.length).toBeLessThan(MIN_SLOT_BLOCK_CHARS);
    getDocPlainTextMock.mockResolvedValue(docWith(curto));
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [curto],
    });
    expect(report.applied).toBe(false);
    expect(report.issues[0].reason).toBe("too-short");
  });

  it("TUDO OU NADA: um parágrafo problemático aborta o bloco inteiro", async () => {
    // CLAUSULA_A está ok; CLAUSULA_B se repete → nada pode ser aplicado, senão
    // o doc ficaria com o token E o texto antigo (duas garantias no contrato).
    getDocPlainTextMock.mockResolvedValue(
      `${docWith(CLAUSULA_A, CLAUSULA_B)}\nANEXO\n${CLAUSULA_B}`
    );
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A, CLAUSULA_B],
    });
    expect(report.applied).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].reason).toBe("ambiguous");
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("doc ilegível não lança — reporta e deixa a cláusula fixa", async () => {
    getDocPlainTextMock.mockRejectedValue(new Error("invalid_grant"));
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });
    expect(report.applied).toBe(false);
    expect(report.issues[0].reason).toBe("doc-unreadable");
  });

  it("falha do batchUpdate devolve applied:false (nunca lança)", async () => {
    batchUpdateDocMock.mockRejectedValue(new Error("429"));
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });
    expect(report.applied).toBe(false);
    expect(report.token).toBeNull();
    expect(report.issues[0].reason).toBe("batch-failed");
  });

  // ——— Trava 3: conferir o resultado em vez de presumi-lo ———

  it("REGRESSÃO (Trio): replaceAllText casa 0 ocorrências → applied:false", async () => {
    // O parágrafo existe no texto plano (a guarda passa), mas está partido em
    // vários textRun no Doc, então o replace não casa nada. Antes disso o
    // relatório dizia applied:true e o slot era DECLARADO sem existir.
    batchUpdateDocMock.mockResolvedValue({
      data: { replies: [{ replaceAllText: {} }] }, // occurrencesChanged omitido = 0
    });
    getDocPlainTextMock.mockResolvedValue(docWith(CLAUSULA_A));

    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });

    expect(report.applied).toBe(false);
    expect(report.token).toBeNull();
    expect(report.issues[0].reason).toBe("replace-noop");
  });

  it("token ausente na releitura → applied:false mesmo com o batch reportando troca", async () => {
    batchUpdateDocMock.mockResolvedValue(batchOk(1));
    docBeforeAndAfter(docWith(CLAUSULA_A), docWith("outra coisa qualquer"));

    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });

    expect(report.applied).toBe(false);
    expect(report.issues[0].reason).toBe("verify-failed");
  });

  it("parágrafo do bloco sobrando na releitura → applied:false (duas garantias no doc)", async () => {
    batchUpdateDocMock.mockResolvedValue(batchOk(2));
    // O token entrou, mas o 2º parágrafo não foi esvaziado: o contrato sairia
    // com a cláusula injetada E o resto da cláusula antiga logo abaixo.
    docBeforeAndAfter(
      docWith(CLAUSULA_A, CLAUSULA_B),
      docWith("{{slot_garantia}}", CLAUSULA_B)
    );

    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A, CLAUSULA_B],
    });

    expect(report.applied).toBe(false);
    expect(report.issues).toEqual([
      { paragraph: CLAUSULA_B.slice(0, 200), reason: "verify-failed" },
    ]);
  });

  it("replaceAllText casando DEMAIS (cabeçalho/rodapé) também reprova", async () => {
    // A guarda de unicidade só enxerga o texto plano; o replace casa contra o
    // documento inteiro. 2 ocorrências = editamos um lugar não examinado.
    batchUpdateDocMock.mockResolvedValue({
      data: { replies: [{ replaceAllText: { occurrencesChanged: 2 } }] },
    });
    getDocPlainTextMock.mockResolvedValue(docWith(CLAUSULA_A));

    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });

    expect(report.applied).toBe(false);
    expect(report.issues[0].reason).toBe("over-matched");
  });

  it("doc ilegível NA RELEITURA: não aplica, e o motivo diz 'não sei' e não 'deu errado'", async () => {
    batchUpdateDocMock.mockResolvedValue(batchOk(1));
    getDocPlainTextMock
      .mockResolvedValueOnce(docWith(CLAUSULA_A))
      .mockRejectedValueOnce(new Error("500"));

    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA_A],
    });

    expect(report.applied).toBe(false);
    expect(report.issues[0].reason).toBe("verify-unavailable");
  });

  it("lista vazia é no-op silencioso", async () => {
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [],
    });
    expect(report.applied).toBe(false);
    expect(report.issues).toEqual([]);
    expect(getDocPlainTextMock).not.toHaveBeenCalled();
  });

  it("o trecho no relatório é truncado (não polui o draftReport)", async () => {
    const longo = `8.1. ${"muito texto ".repeat(60)}`;
    getDocPlainTextMock.mockResolvedValue("nada a ver");
    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [longo],
    });
    expect(report.issues[0].paragraph).toHaveLength(200);
  });
});

/**
 * O planner transcreve o parágrafo em vez de recortá-lo, e transcrição colapsa
 * espaço duplo. O guardrail do plano aceita (valida por `toParagraphs`, que
 * normaliza); o `replaceAllText` recusaria (é literal). Foi o defeito que deixou
 * o modelo de seguro-fiança da RE/MAX Ativa com a Tokio Marine chumbada, num
 * template que existe justamente para servir quatro seguradoras.
 */
describe("resolveBlockLiteral — a transcrição do planner vs. o texto do doc", () => {
  const COM_ESPACO_DUPLO =
    "8.1. Para garantir as obrigações assumidas neste contrato,  o FIADOR assume responsabilidade solidária,  com renúncia ao benefício de ordem.";
  const lines = (d: string) => d.split(String.fromCharCode(10));
  const TRANSCRITO = normalizeForSlotMatch(COM_ESPACO_DUPLO);

  it("prefere o literal quando ele existe tal e qual", () => {
    const doc = docWith(CLAUSULA_A, CLAUSULA_B);
    expect(resolveBlockLiteral(doc, lines(doc), CLAUSULA_A)).toEqual({
      ok: true,
      literal: CLAUSULA_A,
    });
  });

  it("resolve para o parágrafo REAL quando só o espaçamento difere", () => {
    const doc = docWith(COM_ESPACO_DUPLO);
    expect(TRANSCRITO).not.toBe(COM_ESPACO_DUPLO); // a premissa do defeito
    expect(doc.includes(TRANSCRITO)).toBe(false);
    expect(resolveBlockLiteral(doc, lines(doc), TRANSCRITO)).toEqual({
      ok: true,
      literal: COM_ESPACO_DUPLO,
    });
  });

  it("normalizar não afrouxa a trava de unicidade", () => {
    const doc = docWith(COM_ESPACO_DUPLO, CLAUSULA_B, COM_ESPACO_DUPLO);
    expect(resolveBlockLiteral(doc, lines(doc), TRANSCRITO)).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("parágrafo que não está no doc continua sendo not-found", () => {
    const doc = docWith(CLAUSULA_A);
    expect(resolveBlockLiteral(doc, lines(doc), CLAUSULA_B)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("normalizar não faz dois parágrafos DIFERENTES casarem", () => {
    const doc = docWith(CLAUSULA_A, CLAUSULA_B);
    const quase = CLAUSULA_A.replace("solidária", "subsidiária");
    expect(resolveBlockLiteral(doc, lines(doc), quase)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("aplica de ponta a ponta usando o texto do doc, não o do plano", async () => {
    const doc = docWith(COM_ESPACO_DUPLO);
    batchUpdateDocMock.mockResolvedValue(batchOk(1));
    docBeforeAndAfter(doc, docWith("{{slot_garantia}}"));

    const report = await applyClauseSlotToDoc({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [TRANSCRITO],
    });

    expect(report.applied).toBe(true);
    // O que foi para o Google Docs é o parágrafo COM espaço duplo — o único que
    // o `replaceAllText` conseguiria casar.
    expect(requestsOf()[0].replaceAllText.containsText.text).toBe(
      COM_ESPACO_DUPLO
    );
  });
});
