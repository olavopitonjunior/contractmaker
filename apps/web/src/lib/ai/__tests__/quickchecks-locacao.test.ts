import { describe, it, expect } from "vitest";
import { quickChecksLocacao } from "@/lib/ai/quickChecks";

// CPFs válidos (checksum) pra baseline sem ruído.
const CPF_VALIDO_1 = "39053344705";
const CPF_VALIDO_2 = "52998224725";

const base = {
  locadores: [{ tipo_pessoa: "fisica", nome: "João Locador", cpf: CPF_VALIDO_1 }],
  locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária", cpf: CPF_VALIDO_2 }],
};

describe("quickChecksLocacao", () => {
  it("no-op sem partes de locação (dados de venda)", () => {
    expect(quickChecksLocacao({})).toEqual([]);
    expect(quickChecksLocacao({ locadores: [], locatarios: [] })).toEqual([]);
  });

  it("não acusa nada com CPFs válidos e caução legal", () => {
    const out = quickChecksLocacao({
      ...base,
      garantia: { tipo: "caucao", caucao_meses: 3 },
    });
    expect(out).toEqual([]);
  });

  it("acusa CPF inválido de locador/locatário/fiador", () => {
    const out = quickChecksLocacao({
      locadores: [{ tipo_pessoa: "fisica", nome: "João", cpf: "11111111111" }],
      locatarios: [{ tipo_pessoa: "fisica", nome: "Maria", cpf: CPF_VALIDO_2 }],
    });
    expect(out.some((f) => f.category === "qualification" && /CPF de Locador/.test(f.message))).toBe(
      true
    );
  });

  it("acusa caução acima de 3 aluguéis (art. 38 §2º) como error", () => {
    const out = quickChecksLocacao({
      ...base,
      garantia: { tipo: "caucao", caucao_meses: 4 },
    });
    const finding = out.find((f) => /Caução/.test(f.message));
    expect(finding?.severity).toBe("error");
  });

  it("alerta multa rescisória acima de 3 aluguéis (art. 4º)", () => {
    const out = quickChecksLocacao({
      ...base,
      config: { multa_rescisoria_meses: 6 },
    });
    const finding = out.find((f) => /Multa rescisória/.test(f.message));
    expect(finding?.severity).toBe("warning");
  });

  it("valida CNPJ de parte PJ e detecta CPF duplicado com nomes divergentes", () => {
    const out = quickChecksLocacao({
      locadores: [
        { tipo_pessoa: "fisica", nome: "João Silva", cpf: CPF_VALIDO_1 },
        { tipo_pessoa: "fisica", nome: "Joao S.", cpf: CPF_VALIDO_1 },
      ],
      locatarios: [{ tipo_pessoa: "juridica", razao_social: "Empresa X", cnpj: "11111111111111" }],
    });
    expect(out.some((f) => /CNPJ de Locatário/.test(f.message))).toBe(true);
    expect(out.some((f) => /aparece com nomes diferentes/.test(f.message))).toBe(true);
  });
});
