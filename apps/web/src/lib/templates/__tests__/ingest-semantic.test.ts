import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * As checagens semânticas rodam NA INGESTÃO, não só quando alguém abre a tela
 * e clica em "Revalidar".
 *
 * Era o buraco estrutural do fluxo: as regras existiam e um modelo recém-criado
 * nascia com o defeito INVISÍVEL. Foi assim que os 16 modelos da RE/MAX Trio
 * chegaram a "prontos" com a lista de rateio chaveada item a item — ninguém
 * tinha o que olhar. Nenhum tenant novo deve repetir isso.
 */
const uploadMock = vi.fn();
vi.mock("@/lib/google/upload-file-as-gdoc", () => ({
  uploadFileAsGoogleDoc: (...a: unknown[]) => uploadMock(...a),
}));
const aiMock = vi.fn();
vi.mock("@/lib/templates/ai-placeholder-insertion", () => ({
  insertPlaceholdersWithAI: (...a: unknown[]) => aiMock(...a),
}));
const docTextMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: (...a: unknown[]) => docTextMock(...a),
  exportDocAsPdf: async () => Buffer.from("%PDF-1.4 fake"),
}));
vi.mock("@/lib/google/client", () => ({ getDocsClient: () => ({}) }));

import { ingestTemplateFromDocx } from "../ingest-template-from-docx";

const templateUpdate = vi.fn();
const orgFindUnique = vi.fn();

function draftReport(): Record<string, unknown> | undefined {
  const calls = templateUpdate.mock.calls.filter((c) => c[0]?.data?.draftReport);
  return calls.at(-1)?.[0].data.draftReport as Record<string, unknown> | undefined;
}

const base = {
  orgId: "org1",
  buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(40).fill(0x41)]),
  filename: "modelo.docx",
  modalidade: "locacao",
};

// O defeito REAL, copiado do Doc de produção da RE/MAX Trio.
const CABECALHO =
  "4.1.1. O pagamento correspondente ao primeiro aluguel será rateado da seguinte forma:";
const ITEM_A =
  "a) R$0000 (três mil reais), a ser pago diretamente à imobiliária intermediadora {{imobiliaria_qualificacao}}, como honorários pela intermediação;";
const ITEM_B =
  "b) R$ 1.315,15, a ser pago diretamente à corretora intermediadora {{corretagem_dados_pagamento}}";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(prisma.contractTemplate, {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "tpl1", name: "Modelo" }),
    update: templateUpdate.mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  });
  Object.assign(prisma.organization, { findUnique: orgFindUnique.mockResolvedValue(null) });
  uploadMock.mockResolvedValue({
    docId: "doc1",
    webViewLink: "http://doc",
    embedLink: "http://embed",
  });
  aiMock.mockResolvedValue({
    inserted: [],
    skippedAmbiguous: [],
    notMapped: [],
    missingRequired: [],
    ranAt: "2026-09-04T00:00:00.000Z",
    docTruncated: false,
    responseTruncated: false,
  });
  docTextMock.mockResolvedValue([CABECALHO, ITEM_A, ITEM_B].join("\n"));
});

describe("ingestão roda as checagens semânticas", () => {
  it("o modelo NASCE com o defeito visível no relatório, sem revalidação manual", async () => {
    await ingestTemplateFromDocx({ ...base });
    const semantic = draftReport()?.semantic as
      | { findings: Array<{ category: string; severity: string }> }
      | undefined;
    expect(semantic).toBeDefined();
    const rateio = semantic!.findings.filter((f) => f.category === "split-list-tokenized");
    expect(rateio).toHaveLength(1);
    expect(rateio[0]!.severity).toBe("error");
  });

  it("o relatório gravado é o PERSISTÍVEL: sem a frase crua do conserto", async () => {
    await ingestTemplateFromDocx({ ...base });
    const semantic = draftReport()?.semantic as {
      findings: Array<{ suggestedFix?: { op: string; paragraphs?: unknown } }>;
    };
    const fix = semantic.findings.find((f) => f.suggestedFix)?.suggestedFix;
    expect(fix).toEqual({ op: "replace-block" });
    // Os parágrafos do contrato não vão para o jsonb.
    expect(JSON.stringify(draftReport())).not.toContain("1.315,15");
  });

  it("documento ilegível não inventa relatório — não medido nunca é 'está limpo'", async () => {
    docTextMock.mockRejectedValue(new Error("Drive fora"));
    await ingestTemplateFromDocx({ ...base });
    expect(draftReport()?.semantic).toBeUndefined();
  });

  it("falha nas checagens não derruba a ingestão", async () => {
    orgFindUnique.mockRejectedValue(new Error("banco fora"));
    const out = await ingestTemplateFromDocx({ ...base });
    expect(out.templateId).toBe("tpl1");
    expect(draftReport()?.semantic).toBeUndefined();
  });

  it("com `sourceText`, as regras que dependem do fonte passam a valer", async () => {
    // Sem fonte, o colapso de uma cláusula é no máximo aviso; com o fonte, a
    // regra afirma o que havia ali. É o que o lote passa a entregar de graça.
    const abre = "Das partes:";
    const fecha = "Resolvem celebrar o presente contrato.";
    docTextMock.mockResolvedValue([abre, "{{locadores_qualificacao}}", fecha].join("\n"));
    const fonte = [
      abre,
      "a) R$ 2.500,00 a ser pago à imobiliária, como honorários pela intermediação;",
      fecha,
    ].join("\n");
    await ingestTemplateFromDocx({ ...base, sourceText: fonte });
    const semantic = draftReport()?.semantic as {
      findings: Array<{ category: string; severity: string }>;
      sourceAvailable: boolean;
    };
    // O que este caso afirma é que o fonte CHEGA às regras — `sourceAvailable`
    // é a diferença entre "não havia com que comparar" e "comparei". A
    // severidade do colapso depende do alinhamento por âncoras, que é
    // comportamento da própria regra e tem teste lá; exigi-la aqui seria este
    // caso falhando por um motivo que não é o dele.
    expect(semantic.sourceAvailable).toBe(true);
    expect(semantic.findings.some((f) => f.category === "collapsed-paragraph")).toBe(true);
  });

  it("sem `sourceText`, o relatório DIZ que não comparou — em vez de calar", async () => {
    await ingestTemplateFromDocx({ ...base });
    const semantic = draftReport()?.semantic as { sourceAvailable: boolean };
    expect(semantic.sourceAvailable).toBe(false);
  });
});
