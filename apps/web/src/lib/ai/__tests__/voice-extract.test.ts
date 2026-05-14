import { describe, it, expect } from "vitest";
import {
  parseVoiceJson,
  SUPPORTED_VOICE_MIMES,
} from "../voice-extract";

describe("parseVoiceJson", () => {
  it("JSON válido com paths flat retorna objeto", () => {
    const raw = `{"vendedores.0.nome": "João", "vendedores.0.cpf": "12345678901"}`;
    const r = parseVoiceJson(raw);
    expect(r).toEqual({
      "vendedores.0.nome": "João",
      "vendedores.0.cpf": "12345678901",
    });
  });

  it("skip null, undefined e string vazia", () => {
    const raw = JSON.stringify({
      "vendedores.0.nome": "João",
      "vendedores.0.cpf": null,
      "vendedores.0.rg": "",
      "vendedores.0.email": "joao@x.com",
    });
    const r = parseVoiceJson(raw);
    expect(r).toEqual({
      "vendedores.0.nome": "João",
      "vendedores.0.email": "joao@x.com",
    });
  });

  it("pathScope filtra paths fora do escopo top-level", () => {
    const raw = JSON.stringify({
      "vendedores.0.nome": "João",
      "compradores.0.nome": "Maria",
      "imoveis.0.rua": "Augusta",
    });
    const r = parseVoiceJson(raw, ["vendedores"]);
    expect(r).toEqual({ "vendedores.0.nome": "João" });
    expect(r).not.toHaveProperty("compradores.0.nome");
    expect(r).not.toHaveProperty("imoveis.0.rua");
  });

  it("pathScope com múltiplos tops aceita todos", () => {
    const raw = JSON.stringify({
      "vendedores.0.nome": "João",
      "imoveis.0.rua": "Augusta",
      "compradores.0.nome": "Maria",
    });
    const r = parseVoiceJson(raw, ["vendedores", "imoveis"]);
    expect(r).toHaveProperty("vendedores.0.nome");
    expect(r).toHaveProperty("imoveis.0.rua");
    expect(r).not.toHaveProperty("compradores.0.nome");
  });

  it("markdown fence wrap é tolerado (regex pega objeto interno)", () => {
    const raw = '```json\n{"vendedores.0.nome": "João"}\n```';
    const r = parseVoiceJson(raw);
    expect(r).toEqual({ "vendedores.0.nome": "João" });
  });

  it("JSON inválido retorna {}", () => {
    expect(parseVoiceJson("not json")).toEqual({});
    expect(parseVoiceJson("{ unterminated")).toEqual({});
    expect(parseVoiceJson("")).toEqual({});
  });

  it("array no top level retorna {}", () => {
    expect(parseVoiceJson("[1, 2, 3]")).toEqual({});
  });

  it("aceita valores number e boolean", () => {
    const raw = JSON.stringify({
      "pagamento.valor_total": 350000,
      "vendedores.0.tem_procurador": true,
    });
    const r = parseVoiceJson(raw);
    expect(r["pagamento.valor_total"]).toBe(350000);
    expect(r["vendedores.0.tem_procurador"]).toBe(true);
  });
});

describe("SUPPORTED_VOICE_MIMES", () => {
  it("contém audio/webm e variantes opus", () => {
    expect(SUPPORTED_VOICE_MIMES.has("audio/webm")).toBe(true);
    expect(SUPPORTED_VOICE_MIMES.has("audio/webm;codecs=opus")).toBe(true);
    expect(SUPPORTED_VOICE_MIMES.has("audio/ogg")).toBe(true);
    expect(SUPPORTED_VOICE_MIMES.has("audio/ogg;codecs=opus")).toBe(true);
  });

  it("contém audio/mp4 e m4a (Safari iOS)", () => {
    expect(SUPPORTED_VOICE_MIMES.has("audio/mp4")).toBe(true);
    expect(SUPPORTED_VOICE_MIMES.has("audio/m4a")).toBe(true);
    expect(SUPPORTED_VOICE_MIMES.has("audio/x-m4a")).toBe(true);
  });

  it("rejeita MIMEs não-áudio", () => {
    expect(SUPPORTED_VOICE_MIMES.has("application/pdf")).toBe(false);
    expect(SUPPORTED_VOICE_MIMES.has("image/png")).toBe(false);
    expect(SUPPORTED_VOICE_MIMES.has("video/mp4")).toBe(false);
  });
});
