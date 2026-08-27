import { describe, it, expect } from "vitest";
import {
  buildVoicePrompt,
  __STEP_SCHEMA_BY_ESTEIRA as SCHEMAS,
} from "../voice-extract";
import { STEP_PATHS } from "@/lib/forms/participant-visibility";

/**
 * O ditado por voz existia so em venda. Um mapa unico de step -> campos nao
 * servia para as duas esteiras: os indices COLIDEM (em venda 1 e Vendedor, em
 * locacao 1 e Locador) e o filtro por `pathScope` zerava em locacao, fazendo a
 * rota devolver `{}` em silencio.
 */
describe("voice-extract — schema por esteira", () => {
  it("os indices de step significam coisas diferentes em cada esteira", () => {
    expect(SCHEMAS.venda[1].paths[0].path).toMatch(/^vendedores\./);
    expect(SCHEMAS.locacao[1].paths[0].path).toMatch(/^locadores\./);
    expect(SCHEMAS.venda[3].paths[0].path).toMatch(/^imoveis\./);
    expect(SCHEMAS.locacao[3].paths[0].path).toMatch(/^imovel\./);
  });

  it("locacao cobre os 5 steps ditaveis (1-5)", () => {
    expect(Object.keys(SCHEMAS.locacao).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("todo top-key de locacao esta em STEP_PATHS — senao o pathScope zera", () => {
    const permitidos = new Set(
      Object.values(STEP_PATHS.locacao).flatMap((ps) => [...ps])
    );
    for (const [step, spec] of Object.entries(SCHEMAS.locacao)) {
      for (const p of spec.paths) {
        const top = p.path.split(".")[0];
        expect(
          permitidos.has(top),
          `step ${step}: top-key "${top}" nao existe em STEP_PATHS.locacao`
        ).toBe(true);
      }
    }
  });

  it("prompt de locacao cita os paths de locacao, nao os de venda", () => {
    const prompt = buildVoicePrompt(1, undefined, "locacao");
    expect(prompt).toContain("locadores.0.nome");
    expect(prompt).not.toContain("vendedores.0.nome");
  });

  it("pathScope do locador nao zera mais o prompt", () => {
    const prompt = buildVoicePrompt(1, ["locadores"], "locacao");
    expect(prompt).not.toContain("Retorne {}");
    expect(prompt).toContain("locadores.0.cpf");
  });

  it("pathScope do fiador cobre a etapa de garantia", () => {
    const prompt = buildVoicePrompt(5, ["garantia", "observacoes"], "locacao");
    expect(prompt).not.toContain("Retorne {}");
    expect(prompt).toContain("garantia.fiador.nome");
  });

  it("esteira errada continua devolvendo vazio (nao vaza vocabulario)", () => {
    expect(buildVoicePrompt(1, ["locadores"], "venda")).toContain("Retorne {}");
  });

  it("default continua sendo venda (comportamento anterior)", () => {
    expect(buildVoicePrompt(1)).toContain("vendedores.0.nome");
  });

  it("step sem schema devolve o prompt generico", () => {
    expect(buildVoicePrompt(0, undefined, "locacao")).toContain("JSON vazio");
    expect(buildVoicePrompt(6, undefined, "locacao")).toContain("JSON vazio");
  });
});
