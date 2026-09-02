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

  /**
   * `toEqual` com a lista FECHADA, e não `toContain` — issue #486.
   *
   * A versão anterior deste teste usava `toContain`/`not.toContain`: verificava
   * que os argumentos entram e que `this.numero` não entra, e nunca afirmava
   * que `if` e `each` ficam de FORA. Por isso passou por meses enquanto o
   * extrator devolvia `["if", "comissao...", "each", "parcelas"]`.
   *
   * Teste de extrator que só usa `toContain` não consegue detectar extração A
   * MAIS — que é exatamente o modo de falha desta função.
   */
  it("ignora abertura/fechamento de bloco, mas lê o argumento do bloco", () => {
    const paths = extractHandlebarsPaths(
      "{{#if comissao.comissionados.length}}x{{/if}}{{#each parcelas}}{{this.numero}}{{/each}}"
    );
    expect(paths).toEqual(["comissao.comissionados.length", "parcelas"]);
  });

  /**
   * Os block helpers EMBUTIDOS do Handlebars não vêm de
   * `registerHandlebarsHelpers`, então não estão em `HANDLEBARS_HELPER_NAMES`
   * (cuja paridade com o registro é travada por outro teste). Sem estarem em
   * `NON_PATH_TOKENS`, saíam como caminho de dado — e `classify/apply`, que
   * revalida toda chave do conteúdo final, recusava a proposta inteira com
   * `chave_invalida`.
   */
  it("nenhum block helper nativo sai como caminho de dado", () => {
    expect(extractHandlebarsPaths("{{#if garantia.tem_fiador}}x{{/if}}")).toEqual([
      "garantia.tem_fiador",
    ]);
    expect(extractHandlebarsPaths("{{#unless x.y}}z{{/unless}}")).toEqual(["x.y"]);
    expect(extractHandlebarsPaths("{{#with imovel}}{{endereco}}{{/with}}")).toEqual([
      "imovel",
      "endereco",
    ]);
    expect(extractHandlebarsPaths("{{lookup lista chave}}")).toEqual([
      "lista",
      "chave",
    ]);
  });

  /**
   * `this` e `else` já eram excluídos antes desta correção, e pela MESMA
   * razão — mas nunca tiveram teste próprio. Como o bug do `if` mostrou que
   * essa classe passa despercebida por anos, a cobertura acompanha o padrão.
   */
  it("nenhum token de contexto sai como caminho de dado", () => {
    expect(
      extractHandlebarsPaths("{{#each parcelas}}{{this.numero}}{{/each}}")
    ).toEqual(["parcelas"]);
    expect(
      extractHandlebarsPaths("{{#if a.b}}x{{else}}y{{/if}}")
    ).toEqual(["a.b"]);
    expect(extractHandlebarsPaths("{{#each l}}{{@index}}{{/each}}")).toEqual([
      "l",
    ]);
    // Forma composta, que é a que cláusula real usa.
    expect(
      extractHandlebarsPaths("{{#if a.b}}x{{else if c.d}}y{{/if}}")
    ).toEqual(["a.b", "c.d"]);
  });

  /**
   * O descarte casa o caminho INTEIRO, não segmento — `NON_PATH_TOKENS.has`
   * recebe o token pontuado completo. Então um campo de negócio que apenas
   * TERMINE em `if`/`each` continua sendo validado normalmente, e o alcance do
   * descarte é bem mais estreito do que "qualquer segmento".
   */
  it("só descarta o caminho que É o helper, não o que o contém", () => {
    expect(extractHandlebarsPaths("{{contrato.if}}")).toEqual(["contrato.if"]);
    expect(extractHandlebarsPaths("{{each_parcela.valor}}")).toEqual([
      "each_parcela.valor",
    ]);
    expect(extractHandlebarsPaths("{{if}}")).toEqual([]);
  });

  /**
   * O efeito de ponta a ponta: com o helper vazando, TODA cláusula condicional
   * era reprovada mesmo com as chaves de dado corretas. Este teste falava a
   * língua do bug — nenhuma chave rejeitada num texto legítimo.
   */
  it("cláusula condicional com chaves válidas não tem nenhuma chave rejeitada", () => {
    const conteudo =
      "{{#if garantia.caucao_meses}}Caução de {{garantia.caucao_meses}} meses.{{/if}}";
    const rejeitadas = validateContentKeys(conteudo, "locacao").filter(
      (k) => k.tier === "rejeitada"
    );
    expect(rejeitadas).toEqual([]);
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
