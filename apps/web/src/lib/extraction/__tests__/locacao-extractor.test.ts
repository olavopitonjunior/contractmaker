import { describe, expect, it } from "vitest";
import { splitFinalidade } from "../locacao-extractor";
import { parseExtractionJson } from "../genai-extract";

describe("splitFinalidade", () => {
  it("separa finalidade do dataJson persistível", () => {
    const { dataJson, finalidade } = splitFinalidade({
      finalidade: "comercial",
      locatarios: [{ nome: "Padaria Beta" }],
    });
    expect(finalidade).toBe("comercial");
    expect(dataJson).toEqual({ locatarios: [{ nome: "Padaria Beta" }] });
    expect("finalidade" in dataJson).toBe(false);
  });

  it("finalidade ausente/inválida vira residencial", () => {
    expect(splitFinalidade({}).finalidade).toBe("residencial");
    expect(splitFinalidade({ finalidade: "xpto" }).finalidade).toBe("residencial");
  });
});

describe("parseExtractionJson (runner compartilhado)", () => {
  it("parseia JSON puro", () => {
    expect(parseExtractionJson('{"aluguel":{"valor":2500}}')).toEqual({
      aluguel: { valor: 2500 },
    });
  });

  it("parseia JSON embrulhado em markdown", () => {
    const raw = '```json\n{"imovel":{"rua":"X"}}\n```';
    expect(parseExtractionJson(raw)).toEqual({ imovel: { rua: "X" } });
  });

  it("JSON inválido ou sem objeto vira {}", () => {
    expect(parseExtractionJson("não consegui extrair")).toEqual({});
    expect(parseExtractionJson('{"quebrado": ')).toEqual({});
  });
});
