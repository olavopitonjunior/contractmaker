import { describe, expect, it } from "vitest";
import { routeOperatorComments, type FamilySplit, type FanoutItem } from "../plan-fanout";

type Item = FanoutItem & { filename: string };

function split(key: string, filenames: string[]): FamilySplit<Item> {
  return {
    key,
    items: filenames.map((f, i) => ({
      id: `${key}-${i}`,
      filename: f,
      classification: null,
    })),
    grouping: { groups: [] } as never,
  };
}

const SPLITS = [
  split("locacao", ["CONTRATO DE LOCAÇÃO RESIDENCIAL PORTO SEGURO.docx", "CONTRATO DE LOCAÇÃO RESIDENCIAL SEM FIANÇA.docx"]),
  split("locacao_comercial", ["CONTRATO DE LOCAÇÃO COMERCIAL ALMADA.docx"]),
  split("administracao", ["CONTRATO ADMINISTRAÇÃO COM GARANTIA.docx"]),
];

describe("routeOperatorComments", () => {
  it("instrução que cita o arquivo vai SÓ para a família dona", () => {
    const routed = routeOperatorComments(
      ['O "CONTRATO DE LOCAÇÃO COMERCIAL ALMADA.docx" deste lote deve virar o novo modelo.'],
      SPLITS
    );
    expect(routed.get("locacao_comercial")).toHaveLength(1);
    expect(routed.get("locacao")).toEqual([]);
    expect(routed.get("administracao")).toEqual([]);
  });

  it("menção sem extensão e com caixa/acento diferentes também roteia", () => {
    const routed = routeOperatorComments(
      ["o contrato administracao com garantia precisa manter a clausula de repasse"],
      SPLITS
    );
    expect(routed.get("administracao")).toHaveLength(1);
    expect(routed.get("locacao")).toEqual([]);
  });

  it("instrução sem arquivo reconhecível vai para TODAS (comportamento anterior)", () => {
    const routed = routeOperatorComments(
      ["a caução comercial deve virar modelo próprio, não cláusula"],
      SPLITS
    );
    for (const key of ["locacao", "locacao_comercial", "administracao"]) {
      expect(routed.get(key)).toHaveLength(1);
    }
  });

  it("instrução citando arquivos de duas famílias vai para as duas", () => {
    const routed = routeOperatorComments(
      ['Compare "CONTRATO DE LOCAÇÃO COMERCIAL ALMADA.docx" com o "CONTRATO ADMINISTRAÇÃO COM GARANTIA.docx".'],
      SPLITS
    );
    expect(routed.get("locacao_comercial")).toHaveLength(1);
    expect(routed.get("administracao")).toHaveLength(1);
    expect(routed.get("locacao")).toEqual([]);
  });

  it("instruções mistas: cada uma segue a própria rota", () => {
    const routed = routeOperatorComments(
      [
        'Sobre o modelo "X" (arquivo "CONTRATO DE LOCAÇÃO RESIDENCIAL PORTO SEGURO.docx"): trocar o eixo.',
        "regra geral: nenhum modelo nasce ativo",
      ],
      SPLITS
    );
    expect(routed.get("locacao")).toHaveLength(2);
    expect(routed.get("locacao_comercial")).toEqual(["regra geral: nenhum modelo nasce ativo"]);
  });

  it("nome curto demais não vira âncora (anti falso-positivo)", () => {
    const splits = [split("venda", ["OK.docx"]), split("locacao", ["CONTRATO LOCACAO LONGO.docx"])];
    const routed = routeOperatorComments(["tudo ok com o lote, só reprocessar"], splits);
    // "ok" aparece no comentário mas o nome é curto demais → broadcast.
    expect(routed.get("venda")).toHaveLength(1);
    expect(routed.get("locacao")).toHaveLength(1);
  });

  it("sem comentários ou sem splits → mapa vazio/estável", () => {
    expect(routeOperatorComments([], SPLITS).get("locacao")).toEqual([]);
    expect(routeOperatorComments(["algo"], []).size).toBe(0);
  });
});
