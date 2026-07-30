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
    batchUpdateDocMock.mockResolvedValue({});
    getDocPlainTextMock.mockResolvedValue(docWith(CLAUSULA_A, CLAUSULA_B));
  });

  it("troca o 1º parágrafo pelo token e esvazia os demais", async () => {
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
    getDocPlainTextMock.mockResolvedValue(docWith(CLAUSULA_A));
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
