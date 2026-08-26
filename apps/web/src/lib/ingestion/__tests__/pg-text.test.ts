import { describe, expect, it } from "vitest";

import { stripNulDeep, stripNulString } from "@/lib/ingestion/pg-text";
import { clauseKey, KEY_SEP } from "@/lib/ingestion/plan-review";

const NUL = String.fromCharCode(0);

describe("pg-text — a borda de escrita do banco", () => {
  it("tira NUL de string", () => {
    expect(stripNulString("a" + NUL + "b")).toBe("ab");
  });

  it("devolve a mesma referência quando não há NUL (não realoca à toa)", () => {
    const s = "cláusula sem nada de estranho";
    expect(stripNulString(s)).toBe(s);
  });

  it("preserva null e undefined", () => {
    expect(stripNulString(null)).toBeNull();
    expect(stripNulString(undefined)).toBeUndefined();
  });

  it("não toca em quebra de linha nem tabulação — são texto legítimo de contrato", () => {
    const s = "Cláusula 1.\n\tParágrafo único.";
    expect(stripNulString(s)).toBe(s);
  });

  it("limpa recursivamente o que vai para jsonb, inclusive as CHAVES", () => {
    const sujo: Record<string, unknown> = {
      ["chave" + NUL + "composta"]: "valor" + NUL + "sujo",
      lista: ["a" + NUL, { dentro: "b" + NUL + "c" }],
      numero: 42,
      nulo: null,
    };
    expect(stripNulDeep(sujo)).toEqual({
      chavecomposta: "valorsujo",
      lista: ["a", { dentro: "bc" }],
      numero: 42,
      nulo: null,
    });
  });

  it("o conteúdo de cláusula extraído de DOCX com NUL sai gravável", () => {
    const plano = { clauses: [{ content: "Fica ajustado" + NUL + " o seguinte." }] };
    expect(JSON.stringify(stripNulDeep(plano))).not.toContain(NUL);
  });
});

describe("clauseKey — o separador que quebrava a gravação", () => {
  it("não usa NUL (era o 22P05 em produção)", () => {
    const k = clauseKey({ sourceItemId: "item1", tags: ["slot:garantia", "garantia:fiador"] });
    expect(k).not.toContain(NUL);
    expect(k).toContain(KEY_SEP);
  });

  it("continua separando o que precisava separar", () => {
    // A razão de existir do separador: item + conjunto de tags não podem
    // colidir por concatenação ingênua.
    const a = clauseKey({ sourceItemId: "item", tags: ["x:1"] });
    const b = clauseKey({ sourceItemId: "item", tags: ["x:1", "y:2"] });
    const c = clauseKey({ sourceItemId: "itemx", tags: ["1"] });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("ignora ordem das tags — a identidade é o CONJUNTO", () => {
    const a = clauseKey({ sourceItemId: "i", tags: ["b:2", "a:1"] });
    const b = clauseKey({ sourceItemId: "i", tags: ["a:1", "b:2"] });
    expect(a).toBe(b);
  });
});
