import { describe, it, expect } from "vitest";
import {
  VENDA_FIELD_CATALOG,
  LOCACAO_FIELD_CATALOG,
  type FieldCatalogGroup,
} from "@/lib/forms/field-labels";
import {
  KNOWN_FORM_PATH_LIST,
  KNOWN_LOCACAO_PATH_LIST,
  isKnownFormPath,
  isKnownLocacaoFormPath,
} from "@/lib/forms/presets";

/**
 * Teste-GUARDA de paridade entre as três camadas de obrigatoriedade.
 *
 * Antes existiam duas listas mantidas à mão: a ALLOWLIST (o que a rota
 * `PATCH /api/org/form-settings` aceita) e o CATÁLOGO (o que a tela
 * Configurações → Formulário oferece como checkbox). A segunda era um
 * subconjunto da primeira, e a diferença era invisível: a etapa Comissão
 * inteira, os encargos e a garantia de locação, o endereço do cônjuge e os
 * dados de recebimento eram aceitos pela API e não apareciam para o admin.
 *
 * O catálogo passou a ser DERIVADO da allowlist. Estes testes travam as duas
 * pontas: nada aceito pela rota some da tela, e nada exibido na tela é
 * rejeitado pela rota.
 */

function pathsDo(catalog: ReadonlyArray<FieldCatalogGroup>): string[] {
  return catalog.flatMap((g) => g.paths.map((p) => p.path));
}

/**
 * Paths da allowlist que NÃO viram checkbox, com o motivo.
 *
 * O path "guarda-chuva" de uma lista (`vendedores`) significa "existe ao menos
 * uma parte" — é exigência de preset, não campo de formulário.
 */
const FORA_DO_CATALOGO: Record<string, string> = {
  vendedores: "path guarda-chuva da lista, não um campo",
  compradores: "path guarda-chuva da lista, não um campo",
  locadores: "path guarda-chuva da lista, não um campo",
  locatarios: "path guarda-chuva da lista, não um campo",
};

describe("paridade allowlist ↔ catálogo da tela de configurações", () => {
  it("venda: todo path aceito pela rota aparece na tela", () => {
    const noCatalogo = new Set(pathsDo(VENDA_FIELD_CATALOG));
    const faltando = KNOWN_FORM_PATH_LIST.filter(
      (p) => !noCatalogo.has(p) && !FORA_DO_CATALOGO[p]
    );
    expect(faltando).toEqual([]);
  });

  it("locação: todo path aceito pela rota aparece na tela", () => {
    const noCatalogo = new Set(pathsDo(LOCACAO_FIELD_CATALOG));
    const faltando = KNOWN_LOCACAO_PATH_LIST.filter(
      (p) => !noCatalogo.has(p) && !FORA_DO_CATALOGO[p]
    );
    expect(faltando).toEqual([]);
  });

  it("venda: todo path da tela é aceito pela rota", () => {
    expect(pathsDo(VENDA_FIELD_CATALOG).filter((p) => !isKnownFormPath(p))).toEqual(
      []
    );
  });

  it("locação: todo path da tela é aceito pela rota", () => {
    expect(
      pathsDo(LOCACAO_FIELD_CATALOG).filter((p) => !isKnownLocacaoFormPath(p))
    ).toEqual([]);
  });

  it("nenhum path duplicado e todo campo tem rótulo legível", () => {
    for (const catalog of [VENDA_FIELD_CATALOG, LOCACAO_FIELD_CATALOG]) {
      const paths = pathsDo(catalog);
      expect(new Set(paths).size).toBe(paths.length);
      for (const g of catalog) {
        for (const item of g.paths) {
          expect(item.label.trim().length).toBeGreaterThan(0);
          // Rótulo humanizado nunca deve vazar o path cru com pontos.
          expect(item.label).not.toContain(".");
        }
      }
    }
  });

  it("a etapa Comissão deixou de ser inconfigurável nas duas esteiras", () => {
    // Era o buraco que impedia exigir os dados do corretor/angariador.
    for (const catalog of [VENDA_FIELD_CATALOG, LOCACAO_FIELD_CATALOG]) {
      const comissao = catalog.find((g) => g.step === 6);
      expect(comissao?.paths.length ?? 0).toBeGreaterThan(0);
    }
  });
});
