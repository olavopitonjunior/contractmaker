import { describe, it, expect } from "vitest";
import { clauseWriteSchema, normalizeClauseBody } from "./schema";

describe("normalizeClauseBody", () => {
  it("traduz aliases legados (category→subcategory, description→agentNotes)", () => {
    const out = normalizeClauseBody({ category: "sinal", description: "nota" });
    expect(out.subcategory).toBe("sinal");
    expect(out.agentNotes).toBe("nota");
  });

  it("campo AUSENTE continua ausente — PATCH parcial não pode apagar dados", () => {
    // Regressão real: defaultar subcategory/agentNotes aqui fazia um PATCH de
    // só-título gravar subcategory="customizada" e agentNotes=null.
    const out = normalizeClauseBody({ title: "Novo título" });
    expect("subcategory" in out).toBe(false);
    expect("agentNotes" in out).toBe(false);
  });

  it("groupCode vazio/none vira null", () => {
    expect(normalizeClauseBody({ groupCode: "" }).groupCode).toBeNull();
    expect(normalizeClauseBody({ groupCode: "none" }).groupCode).toBeNull();
    expect(normalizeClauseBody({ groupCode: "G4" }).groupCode).toBe("G4");
  });
});

describe("clauseWriteSchema", () => {
  const valid = {
    title: "Cláusula de sinal",
    content: "O sinal de {{moeda pagamento.sinal}} será pago…",
    subcategory: "sinal",
  };

  it("aceita escrita mínima válida", () => {
    expect(clauseWriteSchema.safeParse(valid).success).toBe(true);
  });

  it("subcategory é permissiva (valores legados fora da lista canônica passam)", () => {
    expect(
      clauseWriteSchema.safeParse({ ...valid, subcategory: "acervo-legado_x" }).success
    ).toBe(true);
  });

  it("rejeita groupCode fora de G1..G6 e status desconhecido", () => {
    expect(clauseWriteSchema.safeParse({ ...valid, groupCode: "G7" }).success).toBe(false);
    expect(clauseWriteSchema.safeParse({ ...valid, status: "archived" }).success).toBe(false);
  });

  it(".partial() valida só o que veio (contrato do PATCH)", () => {
    expect(clauseWriteSchema.partial().safeParse({ title: "Só título" }).success).toBe(true);
    expect(clauseWriteSchema.partial().safeParse({ title: "" }).success).toBe(false);
  });
});
