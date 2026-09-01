import { describe, it, expect, beforeEach, vi } from "vitest";

// O setup global dubla `renderContratoHTML`. Este arquivo valida justamente a
// compilação REAL do Handlebars (é a segunda rede do classificador), então
// restaura o módulo inteiro só aqui.
vi.mock("@/lib/render/handlebars", async (importOriginal) =>
  importOriginal<typeof import("@/lib/render/handlebars")>()
);

import {
  extractHandlebarsPaths,
  validateKey,
  validateContentKeys,
  applyMapping,
  assertRendered,
  __resetKeyCatalogCache,
} from "@/lib/clauses/key-catalog";
import { LOCACAO_SEED_CLAUSES } from "@/lib/knowledge/seed-clauses-locacao";
import { VENDAS_SEED_CLAUSES } from "@/lib/knowledge/seed-clauses-vendas";
import { HANDLEBARS_HELPER_NAMES, registerHandlebarsHelpers } from "@/lib/render/handlebars";
import Handlebars from "handlebars";

beforeEach(() => __resetKeyCatalogCache());

describe("HANDLEBARS_HELPER_NAMES não pode divergir do registro real", () => {
  it("lista exatamente os helpers registrados", () => {
    registerHandlebarsHelpers();
    // Built-ins do Handlebars que não vêm de registerHandlebarsHelpers.
    const builtins = new Set([
      "helperMissing",
      "blockHelperMissing",
      "each",
      "if",
      "unless",
      "log",
      "lookup",
      "with",
    ]);
    const registered = Object.keys(Handlebars.helpers).filter((h) => !builtins.has(h));
    expect(registered.sort()).toEqual([...HANDLEBARS_HELPER_NAMES].sort());
  });
});

describe("extractHandlebarsPaths", () => {
  it("pega caminho simples e pontuado", () => {
    expect(extractHandlebarsPaths("Caução de {{garantia.caucao_meses}} meses")).toEqual([
      "garantia.caucao_meses",
    ]);
  });

  it("pula o helper e devolve o argumento", () => {
    // Sem isso, "moeda" seria lido como caminho e a cláusula reprovaria.
    expect(extractHandlebarsPaths("{{moeda aluguel.valor}}")).toEqual(["aluguel.valor"]);
    expect(
      extractHandlebarsPaths("{{numeroExtenso config.multa_rescisoria_meses}}")
    ).toEqual(["config.multa_rescisoria_meses"]);
  });

  it("ignora abertura/fechamento de bloco, mas lê o argumento do bloco", () => {
    const paths = extractHandlebarsPaths(
      "{{#if comissao.comissionados.length}}x{{/if}}{{#each parcelas}}{{this.numero}}{{/each}}"
    );
    expect(paths).toContain("comissao.comissionados.length");
    expect(paths).toContain("parcelas");
    expect(paths).not.toContain("this.numero");
  });

  it("ignora literais, números e comentários", () => {
    expect(extractHandlebarsPaths('{{eq config.tipo "fiador"}}')).toEqual(["config.tipo"]);
    expect(extractHandlebarsPaths("{{! comentário }}")).toEqual([]);
    expect(extractHandlebarsPaths("{{numero valor 2}}")).toEqual(["valor"]);
  });

  it("lê triple-stache", () => {
    expect(extractHandlebarsPaths("{{{bloco_administradora}}}")).toEqual([
      "bloco_administradora",
    ]);
  });

  it("não confunde texto sem chaves", () => {
    expect(extractHandlebarsPaths("cláusula sem variável")).toEqual([]);
  });
});

describe("catálogo cobre os seeds reais (critério de aceite)", () => {
  it("nenhuma chave das cláusulas de LOCAÇÃO é rejeitada", () => {
    // Se este teste falhar, o catálogo está incompleto — não a cláusula.
    const rejeitadas: string[] = [];
    for (const c of LOCACAO_SEED_CLAUSES) {
      for (const { path, tier } of validateContentKeys(c.content, "locacao")) {
        if (tier === "rejeitada") rejeitadas.push(`${c.title} → ${path}`);
      }
    }
    expect(rejeitadas).toEqual([]);
  });

  it("nenhuma chave das cláusulas de VENDA é rejeitada", () => {
    const rejeitadas: string[] = [];
    for (const c of VENDAS_SEED_CLAUSES) {
      for (const { path, tier } of validateContentKeys(c.content, "venda")) {
        if (tier === "rejeitada") rejeitadas.push(`${c.title} → ${path}`);
      }
    }
    expect(rejeitadas).toEqual([]);
  });

  it("garantia.caucao_meses é CONDICIONAL, não rejeitada", () => {
    // O fixture de locação fixa garantia.tipo = "titulo_capitalizacao", então
    // esta chave resolve vazio — mas é chave de cláusula curada real.
    expect(validateKey("garantia.caucao_meses", "locacao")).not.toBe("rejeitada");
  });

  it("chave inventada é rejeitada", () => {
    expect(validateKey("inexistente.totalmente.falso", "locacao")).toBe("rejeitada");
    expect(validateKey("chute", "venda")).toBe("rejeitada");
  });
});

describe("applyMapping", () => {
  it("substitui trecho de ocorrência única", () => {
    const r = applyMapping("multa de 3 aluguéis", "3", "config.multa_rescisoria_meses");
    expect(r).toEqual({
      ok: true,
      content: "multa de {{config.multa_rescisoria_meses}} aluguéis",
    });
  });

  it("recusa trecho ambíguo (2 ocorrências)", () => {
    // A forma clássica de tokenizar o parágrafo errado.
    expect(applyMapping("3 meses e 3 dias", "3", "x")).toEqual({
      ok: false,
      reason: "ambiguo",
    });
  });

  it("recusa trecho ausente", () => {
    expect(applyMapping("texto", "inexistente", "x")).toEqual({
      ok: false,
      reason: "nao_encontrado",
    });
  });
});

describe("assertRendered", () => {
  it("aprova conteúdo válido", () => {
    expect(assertRendered("Aluguel de {{moeda aluguel.valor}}.", "locacao").ok).toBe(true);
  });

  it("reprova Handlebars quebrado", () => {
    const r = assertRendered("{{#if x}}sem fechamento", "locacao");
    expect(r.ok).toBe(false);
  });
});
