/**
 * Validação do escopo de RAG gravável (`AgentProfile.ragScope`).
 *
 * O campo é lido pelo `knowledge-scope.ts` pra restringir o que cada agente
 * enxerga na base. Um escopo mal validado não erra: ele silenciosamente devolve
 * menos resultado — que é o modo de falha mais caro de diagnosticar num RAG.
 */

import { describe, it, expect } from "vitest";
import { ragScopeSchema, RAG_SCOPE_CATEGORIES } from "../store";

describe("ragScopeSchema", () => {
  it("aceita escopo completo", () => {
    const r = ragScopeSchema.safeParse({
      categories: ["clause", "legislation"],
      tags: ["locacao"],
      includePlatform: false,
    });
    expect(r.success).toBe(true);
  });

  it("aceita null — apaga o escopo e volta a herdar", () => {
    expect(ragScopeSchema.safeParse(null).success).toBe(true);
  });

  it("aceita objeto vazio — sem restrição", () => {
    expect(ragScopeSchema.safeParse({}).success).toBe(true);
  });

  it("REJEITA a categoria support", () => {
    // `knowledge-scope.ts` exclui `support` do RAG jurídico de qualquer jeito;
    // aceitar aqui deixaria montar um escopo que sempre volta vazio.
    const r = ragScopeSchema.safeParse({ categories: ["support"] });
    expect(r.success).toBe(false);
    expect(RAG_SCOPE_CATEGORIES).not.toContain("support");
  });

  it("rejeita categoria inventada", () => {
    expect(ragScopeSchema.safeParse({ categories: ["juridiques"] }).success).toBe(false);
  });

  it("rejeita campo desconhecido em vez de ignorar", () => {
    // `.strict()`: um `includePlataforma` (typo) que passasse silenciosamente
    // gravaria escopo sem o efeito que o admin quis.
    expect(
      ragScopeSchema.safeParse({ includePlataforma: false }).success
    ).toBe(false);
  });

  it("rejeita tag vazia e limita a quantidade", () => {
    expect(ragScopeSchema.safeParse({ tags: [""] }).success).toBe(false);
    expect(
      ragScopeSchema.safeParse({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })
        .success
    ).toBe(false);
  });
});
