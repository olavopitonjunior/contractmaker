import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * A7 — o estágio determinístico (gabarito → chaves) entra na ingestão DEPOIS
 * do passe de IA e ANTES da releitura final; o relatório do passe é
 * reconciliado com o texto final; o gabarito nunca vai cru para o jsonb.
 */
const uploadMock = vi.fn();
vi.mock("@/lib/google/upload-file-as-gdoc", () => ({
  uploadFileAsGoogleDoc: (...a: unknown[]) => uploadMock(...a),
}));
const aiMock = vi.fn();
vi.mock("@/lib/templates/ai-placeholder-insertion", () => ({
  insertPlaceholdersWithAI: (...a: unknown[]) => aiMock(...a),
}));
const reverseMock = vi.fn();
vi.mock("@/lib/templates/reverse-merge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/templates/reverse-merge")>(
    "@/lib/templates/reverse-merge"
  );
  // Só o motor é mockado; `maskReverseMergeReport` é o real (puro).
  return { ...actual, reverseMergeDocToTemplate: (...a: unknown[]) => reverseMock(...a) };
});
const extractMock = vi.fn();
vi.mock("@/lib/extraction/locacao-extractor", () => ({
  extractLocacaoContractDataJson: (...a: unknown[]) => extractMock(...a),
}));
const docTextMock = vi.fn();
const exportPdfMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: (...a: unknown[]) => docTextMock(...a),
  exportDocAsPdf: (...a: unknown[]) => exportPdfMock(...a),
}));
vi.mock("@/lib/google/client", () => ({ getDocsClient: () => ({}) }));

import {
  gabaritoFromSourceValues,
  ingestTemplateFromDocx,
  reconcileReportWithReverseMerge,
} from "../ingest-template-from-docx";

const order: string[] = [];
const templateUpdate = vi.fn();

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

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  // Muta o singleton mockado do setup.ts IN PLACE. Seguro porque o vitest
  // isola o registro de módulos por arquivo (default `isolate: true`); se um
  // dia isso for relaxado, este bloco vira poluição entre arquivos.
  Object.assign(prisma.contractTemplate, {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "tpl1", name: "Modelo" }),
    update: templateUpdate.mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  });
  uploadMock.mockResolvedValue({ docId: "doc1", webViewLink: "http://doc", embedLink: "http://embed" });
  extractMock.mockResolvedValue({ dataJson: {}, finalidade: "residencial", finalidadeDetected: false });
  exportPdfMock.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  aiMock.mockImplementation(async () => {
    order.push("ai");
    return {
      inserted: [{ token: "locadores_qualificacao", trecho: "x" }],
      skippedAmbiguous: [],
      notMapped: [
        { token: "aluguel_valor", reason: "no-mapping" },
        { token: "imovel_identificacao", reason: "ambiguous", trecho: "casa" },
      ],
      missingRequired: ["aluguel_valor", "imovel_identificacao"],
      ranAt: "2026-09-02T00:00:00.000Z",
      docTruncated: false,
      responseTruncated: false,
    };
  });
  reverseMock.mockImplementation(async () => {
    order.push("reverse");
    return {
      replaced: [{ token: "aluguel_valor", value: "R$ 2.500,00", occurrences: 3 }],
      skipped: [
        { token: "imovel_identificacao", value: "casa", reason: "ambiguous", occurrences: 2 },
        { token: "locatarios_qualificacao", value: "Bruno Tavares, CPF 529.982.247-25", reason: "not-found" },
      ],
    };
  });
  docTextMock.mockImplementation(async () => {
    order.push("reread");
    return "Locadora {{locadores_qualificacao}}. Aluguel {{aluguel_valor}}. Imóvel casa. Vistoria casa.";
  });
});

describe("ingestTemplateFromDocx — estágio determinístico (gabarito)", () => {
  it("sem gabarito: fluxo antigo, reverse-merge não roda e o relatório não ganha a chave", async () => {
    await ingestTemplateFromDocx({ ...base });
    expect(reverseMock).not.toHaveBeenCalled();
    expect(draftReport()?.reverseMerge).toBeUndefined();
  });

  it("com gabarito: roda DEPOIS da IA e ANTES da releitura; enrich de locação aplicado", async () => {
    await ingestTemplateFromDocx({
      ...base,
      sourceValues: { aluguel: { valor: 2500 }, locadores: [{ nome: "Ana" }] },
    });
    expect(order).toEqual(["ai", "reverse", "reread"]);
    const arg = reverseMock.mock.calls[0][0] as { docId: string; modalidade: string; dataJson: Record<string, unknown> };
    expect(arg.docId).toBe("doc1");
    expect(arg.modalidade).toBe("locacao");
    expect(arg.dataJson.aluguel).toEqual({ valor: 2500 });
    // SEM defaults de fábrica no gabarito: nada de multa 10% / juros 1%
    // inventados que casariam a cláusula errada.
    expect(arg.dataJson.config).toEqual({});
  });

  it("gabaritoFromSourceValues: pontes do enrich entram, defaults de config NÃO; config do gabarito fica", () => {
    const g = gabaritoFromSourceValues(
      { aluguel: { valor: 2500 }, config: { multa_atraso_percent: 2 } },
      "locacao"
    );
    expect(g.config).toEqual({ multa_atraso_percent: 2 });
    expect((g.config as Record<string, unknown>).juros_mensais_atraso).toBeUndefined();
    // venda passa como está (o enrich de venda fica para quando houver gabarito de venda)
    const v = { preco: 1 };
    expect(gabaritoFromSourceValues(v, "a_vista")).toBe(v);
  });

  it("o relatório é reconciliado com o texto final e o gabarito sai MASCARADO do jsonb", async () => {
    await ingestTemplateFromDocx({ ...base, sourceValues: { aluguel: { valor: 2500 } } });
    const r = draftReport()!;
    const notMapped = r.notMapped as Array<Record<string, unknown>>;
    // aluguel_valor foi posto pelo reverse-merge → deixa de ser "não mapeado".
    expect(notMapped.map((n) => n.token)).not.toContain("aluguel_valor");
    expect(r.missingRequired).not.toContain("aluguel_valor");
    // imovel_identificacao: o motivo da IA vence, e ganha o gabarito + ocorrências.
    const casa = notMapped.find((n) => n.token === "imovel_identificacao")!;
    expect(casa.reason).toBe("ambiguous");
    expect(casa.sourceValue).toBe("casa");
    expect(casa.occurrences).toBe(2);
    // locatarios_qualificacao: a IA não tinha proposto → o motivo do reverse-merge entra, mascarado.
    const loc = notMapped.find((n) => n.token === "locatarios_qualificacao")!;
    expect(loc.reason).toBe("not-found");
    expect(String(loc.sourceValue)).not.toContain("529.982.247-25");
    expect(String(loc.sourceValue)).toContain("000.000.000-00");
    // O bloco reverseMerge gravado também não carrega o CPF.
    expect(JSON.stringify(r.reverseMerge)).not.toContain("529.982.247-25");
    expect(JSON.stringify(r)).not.toContain("529.982.247-25");
  });

  it("reverse-merge falhando não derruba a ingestão nem o relatório da IA", async () => {
    reverseMock.mockRejectedValue(new Error("Drive 500"));
    const out = await ingestTemplateFromDocx({ ...base, sourceValues: { aluguel: { valor: 2500 } } });
    expect(out.templateId).toBe("tpl1");
    expect(draftReport()?.reverseMerge).toBeUndefined();
    expect((draftReport()?.inserted as unknown[]).length).toBe(1);
  });
});

describe("ingestTemplateFromDocx — gabarito extraído do próprio DOCX (A8)", () => {
  it("extractGabarito: extrai do PDF exportado do Doc, em paralelo com o passe de IA, e alimenta o reverse-merge", async () => {
    let releaseAi: () => void = () => {};
    aiMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseAi = () => {
            order.push("ai");
            resolve({ inserted: [], skippedAmbiguous: [], notMapped: [], missingRequired: [], ranAt: "" });
          };
        })
    );
    extractMock.mockImplementation(async (buffer: Buffer, mime: string, ctx: Record<string, unknown>) => {
      // PDF exportado do Doc — não o DOCX cru (o Gemini lê DOCX de forma irregular).
      expect(buffer.toString()).toContain("%PDF");
      expect(mime).toBe("application/pdf");
      expect(ctx).toEqual({ orgId: "org1", userId: "u1", contractId: null });
      return { dataJson: { aluguel: { valor: 2500 } }, finalidade: "residencial", finalidadeDetected: true };
    });
    const pending = ingestTemplateFromDocx({ ...base, extractGabarito: { userId: "u1" } });
    // O passe de IA ainda está pendente e a extração JÁ foi chamada (paralelo).
    await new Promise((r) => setTimeout(r, 0));
    expect(exportPdfMock).toHaveBeenCalledWith("doc1");
    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(reverseMock).not.toHaveBeenCalled();
    releaseAi();
    await pending;
    expect(reverseMock).toHaveBeenCalledTimes(1);
    const arg = reverseMock.mock.calls[0][0] as { dataJson: Record<string, unknown> };
    expect(arg.dataJson.aluguel).toEqual({ valor: 2500 });
  });

  it("export PDF falhando → extrai do DOCX cru (não pior que antes)", async () => {
    exportPdfMock.mockRejectedValue(new Error("Drive 500"));
    extractMock.mockImplementation(async (buffer: Buffer, mime: string) => {
      expect(mime).toContain("wordprocessingml");
      expect(buffer.length).toBeGreaterThan(4);
      return { dataJson: { aluguel: { valor: 1 } }, finalidade: "residencial", finalidadeDetected: false };
    });
    await ingestTemplateFromDocx({ ...base, extractGabarito: { userId: null } });
    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(reverseMock).toHaveBeenCalledTimes(1);
  });

  it("upload falhando → nenhuma extração é disparada (nada de Gemini órfão)", async () => {
    uploadMock.mockRejectedValue(new Error("Drive 503"));
    await expect(ingestTemplateFromDocx({ ...base, extractGabarito: { userId: "u1" } })).rejects.toThrow();
    expect(extractMock).not.toHaveBeenCalled();
    expect(exportPdfMock).not.toHaveBeenCalled();
  });

  it("família locação inteira: temporada e administracao_locacao também extraem", async () => {
    await ingestTemplateFromDocx({ ...base, modalidade: "temporada", extractGabarito: { userId: "u1" } });
    await ingestTemplateFromDocx({ ...base, modalidade: "administracao_locacao", extractGabarito: { userId: "u1" } });
    expect(extractMock).toHaveBeenCalledTimes(2);
  });

  it("extração falhando → sem gabarito, ingestão segue e nada de reverse-merge", async () => {
    extractMock.mockRejectedValue(new Error("Gemini 503"));
    const out = await ingestTemplateFromDocx({ ...base, extractGabarito: { userId: null } });
    expect(out.templateId).toBe("tpl1");
    expect(reverseMock).not.toHaveBeenCalled();
    expect(draftReport()?.reverseMerge).toBeUndefined();
  });

  it("sourceValues explícito vence: não extrai", async () => {
    await ingestTemplateFromDocx({ ...base, sourceValues: { aluguel: { valor: 1 } }, extractGabarito: { userId: "u1" } });
    expect(extractMock).not.toHaveBeenCalled();
    expect(reverseMock).toHaveBeenCalledTimes(1);
  });

  it("venda: extractGabarito é ignorado (só locação tem gabarito hoje)", async () => {
    await ingestTemplateFromDocx({ ...base, modalidade: "a_vista", extractGabarito: { userId: "u1" } });
    expect(extractMock).not.toHaveBeenCalled();
  });
});

describe("reconcileReportWithReverseMerge", () => {
  it("token `unconfirmed` do passe de IA continua faltante mesmo estando no texto — o motivo não some", () => {
    const out = reconcileReportWithReverseMerge(
      {
        inserted: [],
        skippedAmbiguous: [{ token: "aluguel_valor", trecho: "x", reason: "over-matched" }],
        notMapped: [{ token: "aluguel_valor", reason: "over-matched", trecho: "x" }],
        missingRequired: ["aluguel_valor"],
        ranAt: "",
        unconfirmed: ["aluguel_valor"],
      },
      { replaced: [], skipped: [] },
      "Aluguel {{aluguel_valor}}. Rodapé {{aluguel_valor}}.",
      "locacao"
    );
    const nm = out.notMapped.find((n) => n.token === "aluguel_valor")!;
    expect(nm.reason).toBe("over-matched");
    expect(out.missingRequired).toContain("aluguel_valor");
  });

  it("token presente no texto final sai de notMapped mesmo que a IA o tivesse listado", () => {
    const out = reconcileReportWithReverseMerge(
      {
        inserted: [],
        skippedAmbiguous: [],
        notMapped: [{ token: "aluguel_valor", reason: "no-mapping" }],
        missingRequired: ["aluguel_valor"],
        ranAt: "",
      },
      { replaced: [{ token: "aluguel_valor", value: "R$ 1,00", occurrences: 1 }], skipped: [] },
      "Aluguel {{aluguel_valor}}.",
      "locacao"
    );
    expect(out.notMapped.map((n) => n.token)).not.toContain("aluguel_valor");
    expect(out.missingRequired).not.toContain("aluguel_valor");
  });
});
