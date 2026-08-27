import { describe, it, expect, vi, beforeEach } from "vitest";

const batchUpdateDocMock = vi.fn();
const getDocPlainTextMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  batchUpdateDoc: (...args: unknown[]) => batchUpdateDocMock(...args),
  getDocPlainText: (...args: unknown[]) => getDocPlainTextMock(...args),
}));

import {
  MIN_PROVIDER_NAME_CHARS,
  neutralReplacementFor,
  neutralizeProvidersInDoc,
} from "../neutralize-provider";

const DOC = [
  "CONTRATO DE LOCAÇÃO RESIDENCIAL",
  "{{slot_garantia}}",
  "Cláusula de pintura: fica a cargo da PORTO SEGURO a vistoria de pintura interna.",
  "Foro da comarca de Piracicaba.",
].join("\n");

const requestsOf = () => batchUpdateDocMock.mock.calls[0]?.[1] ?? [];

describe("neutralizeProvidersInDoc", () => {
  beforeEach(() => {
    // `clearAllMocks` não esvazia filas `Once` — um valor enfileirado e não
    // consumido num teste vazaria para o seguinte. `mockReset` esvazia.
    getDocPlainTextMock.mockReset();
    batchUpdateDocMock.mockReset();
    batchUpdateDocMock.mockResolvedValue({ data: { replies: [] } });
  });

  it("substitui a menção fora do slot e confere o resultado relendo", async () => {
    // O caso real da Ativa: a cláusula de pintura nomeia a Porto Seguro num
    // template que existe para servir quatro seguradoras.
    getDocPlainTextMock
      .mockResolvedValueOnce(DOC)
      .mockResolvedValueOnce(DOC.replace("PORTO SEGURO", "seguradora contratada"));

    const report = await neutralizeProvidersInDoc({
      docId: "doc1",
      providers: ["Porto Seguro"],
      replacement: "seguradora contratada",
    });

    expect(report.clean).toBe(true);
    expect(report.replaced).toEqual([{ provider: "Porto Seguro", occurrences: 1 }]);
    expect(requestsOf()[0].replaceAllText.containsText).toEqual({
      text: "Porto Seguro",
      matchCase: false,
    });
  });

  it("nome mais longo é substituído ANTES do mais curto", async () => {
    const doc = "Contratado junto a TOKIO MARINE SEGURADORA S.A. nesta data.";
    getDocPlainTextMock
      .mockResolvedValueOnce(doc)
      .mockResolvedValueOnce("Contratado junto a seguradora contratada nesta data.");

    await neutralizeProvidersInDoc({
      docId: "doc1",
      providers: ["Tokio Marine", "Tokio Marine Seguradora S.A."],
      replacement: "seguradora contratada",
    });

    const texts = requestsOf().map(
      (r: { replaceAllText: { containsText: { text: string } } }) =>
        r.replaceAllText.containsText.text
    );
    expect(texts[0]).toBe("Tokio Marine Seguradora S.A.");
  });

  it("menção que sobrou na releitura vira leftover — nunca afirmar neutralidade sem conferir", async () => {
    getDocPlainTextMock.mockResolvedValueOnce(DOC).mockResolvedValueOnce(DOC);

    const report = await neutralizeProvidersInDoc({
      docId: "doc1",
      providers: ["Porto Seguro"],
      replacement: "seguradora contratada",
    });

    expect(report.clean).toBe(false);
    expect(report.leftover).toEqual(["Porto Seguro"]);
    expect(report.replaced).toEqual([]);
  });

  it("doc sem menção nenhuma é no-op limpo (não gasta batchUpdate)", async () => {
    getDocPlainTextMock.mockResolvedValueOnce("Contrato sem seguradora nomeada.");
    const report = await neutralizeProvidersInDoc({
      docId: "doc1",
      providers: ["Porto Seguro"],
      replacement: "seguradora contratada",
    });
    expect(report).toEqual({ replaced: [], leftover: [], clean: true });
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("nome curto demais nem entra na varredura", async () => {
    getDocPlainTextMock.mockResolvedValueOnce("O TOO garante esta locação.");
    const report = await neutralizeProvidersInDoc({
      docId: "doc1",
      providers: ["TOO"], // 3 < MIN — casaria dentro de outras palavras
      replacement: "seguradora contratada",
    });
    expect("TOO".length).toBeLessThan(MIN_PROVIDER_NAME_CHARS);
    expect(report.clean).toBe(true);
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("não diferencia caixa — o DOCX grita PORTO SEGURO, o plano diz Porto Seguro", async () => {
    getDocPlainTextMock
      .mockResolvedValueOnce(DOC)
      .mockResolvedValueOnce(DOC.replace("PORTO SEGURO", "seguradora contratada"));
    const report = await neutralizeProvidersInDoc({
      docId: "doc1",
      providers: ["porto seguro"],
      replacement: "seguradora contratada",
    });
    expect(report.clean).toBe(true);
  });

  it("falha de leitura é fail-closed: tudo vira leftover", async () => {
    getDocPlainTextMock.mockRejectedValueOnce(new Error("429"));
    const report = await neutralizeProvidersInDoc({
      docId: "doc1",
      providers: ["Porto Seguro"],
      replacement: "seguradora contratada",
    });
    expect(report.clean).toBe(false);
    expect(report.leftover).toEqual(["Porto Seguro"]);
  });
});

describe("neutralReplacementFor", () => {
  it("escolhe o termo pelo tipo de garantia, com genérico de fallback", () => {
    expect(neutralReplacementFor("seguro_fianca")).toBe("seguradora contratada");
    expect(neutralReplacementFor("garantia_onerosa")).toBe("garantidora contratada");
    expect(neutralReplacementFor("titulo_capitalizacao")).toContain("instituição");
    expect(neutralReplacementFor(null)).toBe("fornecedora da garantia");
    expect(neutralReplacementFor("fiador")).toBe("fornecedora da garantia");
  });
});
