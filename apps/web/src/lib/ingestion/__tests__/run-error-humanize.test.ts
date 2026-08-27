import { describe, it, expect } from "vitest";

import { humanizeRunError } from "@/lib/ingestion/run-error-humanize";

describe("humanizeRunError — payload cru nunca chega ao operador", () => {
  it("o erro REAL do lote de 20 vira frase com ação", () => {
    const raw =
      'A resposta do modelo não é JSON válido: {"templates":[{"sourceItemId":"cmtaayym7000f...';
    const human = humanizeRunError(raw)!;
    expect(human.message).not.toContain("{");
    expect(human.message).not.toContain("sourceItemId");
    expect(human.retryable).toBe(true);
    expect(human.action).toContain("Tentar de novo");
  });

  it("corte por teto de tokens é retryable — o fanout reanalisa por partes", () => {
    const human = humanizeRunError(
      "A resposta do modelo foi cortada no limite de tokens de saída — o resultado não coube."
    )!;
    expect(human.retryable).toBe(true);
  });

  it("teto de custo NÃO é retryable — repetir não muda o teto", () => {
    const human = humanizeRunError(
      "Este lote atingiu o teto de custo (INGESTION_RUN_MAX_USD=5)."
    )!;
    expect(human.retryable).toBe(false);
  });

  it("instabilidade (429/5xx) sugere tentar de novo", () => {
    for (const raw of ["HTTP 429 rate limit", "upstream 503", "fetch failed"]) {
      expect(humanizeRunError(raw)!.retryable).toBe(true);
    }
  });

  it("erro desconhecido cai no fallback, nunca em texto técnico", () => {
    const human = humanizeRunError("TypeError: cannot read properties of undefined")!;
    expect(human.message).toBe("A análise parou por um erro inesperado.");
  });

  it("sem erro, sem tradução", () => {
    expect(humanizeRunError(null)).toBeNull();
    expect(humanizeRunError("")).toBeNull();
    expect(humanizeRunError("   ")).toBeNull();
  });
});
