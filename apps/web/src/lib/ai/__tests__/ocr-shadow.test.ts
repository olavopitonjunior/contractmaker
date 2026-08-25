import { describe, expect, it } from "vitest";
import { compararSombra, shadowModelFromEnv } from "../ocr-shadow";

/**
 * Comparação primário × sombra.
 *
 * O que se protege é a UTILIDADE do sinal. Uma comparação que acusa
 * divergência em todo documento não é rigorosa — é ruído, e ninguém volta a
 * olhar o painel depois da segunda vez. Por isso diferença de pontuação, caixa
 * e acento não conta como divergência de leitura.
 */
const doc = (tipo: string, fields: Record<string, unknown>) => ({
  documentType: tipo,
  fields,
});

describe("compararSombra", () => {
  it("mesmo valor com formatação diferente NÃO é divergência", () => {
    const c = compararSombra(
      doc("rg", { cpf_numero: "529.982.247-25", nome_completo: "JOÃO DA SILVA" }),
      doc("rg", { cpf_numero: "52998224725", nome_completo: "Joao da Silva" })
    );
    expect(c.camposDivergentes).toEqual([]);
    expect(c.camposIguais).toBe(2);
  });

  it("valor realmente diferente é divergência, e só o NOME do campo aparece", () => {
    const c = compararSombra(
      doc("rg", { cpf_numero: "52998224725" }),
      doc("rg", { cpf_numero: "11122233344" })
    );
    expect(c.camposDivergentes).toEqual(["cpf_numero"]);
    // A garantia de PII: o valor não pode vazar para a estrutura gravada.
    expect(JSON.stringify(c)).not.toContain("52998224725");
    expect(JSON.stringify(c)).not.toContain("11122233344");
  });

  /**
   * O sinal mais valioso do shadow: campo que só a SOMBRA leu é dado que o
   * modelo de produção está perdendo HOJE, em tráfego real — coisa que nenhum
   * corpus curado revela.
   */
  it("campo só na sombra é separado de campo só no primário", () => {
    const c = compararSombra(
      doc("cnh", { nome_completo: "Joao", registro_cnh: "123" }),
      doc("cnh", { nome_completo: "Joao", categoria: "AB" })
    );
    expect(c.camposSoNoPrimario).toEqual(["registro_cnh"]);
    expect(c.camposSoNaSombra).toEqual(["categoria"]);
    expect(c.camposIguais).toBe(1);
  });

  it("sentinela de ausência conta como vazio dos dois lados", () => {
    const c = compararSombra(
      doc("rg", { naturalidade: "null", cidade: "" }),
      doc("rg", { naturalidade: null, cidade: "N/A" })
    );
    expect(c.camposDivergentes).toEqual([]);
    expect(c.camposSoNoPrimario).toEqual([]);
    expect(c.camposSoNaSombra).toEqual([]);
  });

  it("categoria divergente é sinalizada", () => {
    const c = compararSombra(doc("matricula", {}), doc("escritura", {}));
    expect(c.categoriaDivergiu).toBe(true);
    expect(c.categoriaPrimaria).toBe("matricula");
    expect(c.categoriaSombra).toBe("escritura");
  });

  it("concordância total não gera ruído nenhum", () => {
    const f = { nome_completo: "Joao", cpf_numero: "52998224725" };
    const c = compararSombra(doc("rg", f), doc("rg", { ...f }));
    expect(c.categoriaDivergiu).toBe(false);
    expect(c.camposDivergentes).toEqual([]);
    expect(c.camposIguais).toBe(2);
  });

  it("nomes vêm ordenados — a linha do banco não muda por ordem de chave", () => {
    const c = compararSombra(
      doc("rg", { zeta: "1", alfa: "2" }),
      doc("rg", { zeta: "9", alfa: "8" })
    );
    expect(c.camposDivergentes).toEqual(["alfa", "zeta"]);
  });
});

describe("shadowModelFromEnv", () => {
  /**
   * Desligado por padrão não é só cautela de produto: o projeto Vercel `web`
   * roda previews contra o banco de PRODUÇÃO sem migrar, e com a flag ligada a
   * escrita cairia numa tabela que ainda não existe lá.
   */
  it("sem a env, o shadow está desligado", () => {
    expect(shadowModelFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("string vazia ou só espaço não liga o shadow", () => {
    expect(shadowModelFromEnv({ OCR_SHADOW_MODEL: "" } as NodeJS.ProcessEnv)).toBeNull();
    expect(shadowModelFromEnv({ OCR_SHADOW_MODEL: "   " } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("com modelo configurado, devolve o modelo", () => {
    expect(
      shadowModelFromEnv({ OCR_SHADOW_MODEL: "gemini-3.5-flash-lite" } as NodeJS.ProcessEnv)
    ).toBe("gemini-3.5-flash-lite");
  });
});
