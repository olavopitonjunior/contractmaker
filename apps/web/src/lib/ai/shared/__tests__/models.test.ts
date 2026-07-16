import { describe, it, expect } from "vitest";
import {
  resolveModel,
  SONNET_MODEL,
  OPUS_MODEL,
  HAIKU_MODEL,
} from "../models";
import { PRICING } from "@/lib/ai/usage";

// Regressão do 404 em prod (2026-07-15): auto-analyze chamava
// claude-sonnet-4-20250514 (aposentado) hardcodado. resolveModel é a barreira
// que impede QUALQUER fonte (env, AgentConfig no banco, default antigo) de
// mandar um ID morto pra API.
describe("resolveModel", () => {
  it("migra IDs aposentados/deprecados pro sucessor atual", () => {
    expect(resolveModel("claude-sonnet-4-20250514")).toBe(SONNET_MODEL);
    expect(resolveModel("claude-opus-4-20250514")).toBe(OPUS_MODEL);
    expect(resolveModel("claude-3-5-sonnet-20240620")).toBe(SONNET_MODEL);
    expect(resolveModel("claude-3-5-sonnet-20241022")).toBe(SONNET_MODEL);
    expect(resolveModel("claude-3-7-sonnet-20250219")).toBe(SONNET_MODEL);
    expect(resolveModel("claude-3-5-haiku-20241022")).toBe(HAIKU_MODEL);
  });

  it("passa adiante IDs atuais sem mexer", () => {
    expect(resolveModel(SONNET_MODEL)).toBe(SONNET_MODEL);
    expect(resolveModel(OPUS_MODEL)).toBe(OPUS_MODEL);
    expect(resolveModel(HAIKU_MODEL)).toBe(HAIKU_MODEL);
    // ID desconhecido pode ser um modelo novo válido — não bloquear.
    expect(resolveModel("claude-modelo-futuro-9")).toBe("claude-modelo-futuro-9");
  });

  it("aplica fallback pra vazio/null/undefined/whitespace", () => {
    expect(resolveModel(undefined)).toBe(SONNET_MODEL);
    expect(resolveModel(null)).toBe(SONNET_MODEL);
    expect(resolveModel("")).toBe(SONNET_MODEL);
    expect(resolveModel("  ")).toBe(SONNET_MODEL);
    expect(resolveModel(undefined, HAIKU_MODEL)).toBe(HAIKU_MODEL);
  });

  it("todo modelo canônico tem preço no PRICING (custo não silencia pra 0)", () => {
    for (const m of [SONNET_MODEL, OPUS_MODEL, HAIKU_MODEL]) {
      expect(PRICING[m], `PRICING sem entrada pra ${m}`).toBeDefined();
    }
  });
});
