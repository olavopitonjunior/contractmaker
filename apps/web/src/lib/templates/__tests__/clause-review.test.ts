import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * A revisão do acervo existe para adiantar uma descoberta que hoje só acontece
 * na geração — e lá o modo de falha é SILENCIOSO: a cláusula quebrada é
 * descartada e o contrato sai com o texto canônico, sem a redação da
 * imobiliária. Estes casos fixam que cada motivo de descarte aparece no painel,
 * e que uma cláusula não classificada é provada nas DUAS esteiras (é onde ela é
 * lida).
 */
/**
 * Render REAL, contra o dublê global do setup.
 *
 * O setup da suíte dubla `renderContratoHTML` para devolver um JSON e nunca
 * lançar — ótimo para quem só quer saber se o render foi chamado, e inútil
 * aqui: a prova deste módulo É o render. Com o dublê, uma cláusula que não
 * compila passaria neste arquivo e quebraria no contrato de verdade, que é
 * exatamente o silêncio que a revisão existe para acabar.
 */
vi.mock("@/lib/render/handlebars", async (importOriginal) =>
  importOriginal<typeof import("@/lib/render/handlebars")>()
);

import { reviewClauseLibrary } from "../clause-review";

const findMany = vi.fn();
Object.assign(prisma.knowledgeItem, { findMany });

function clausula(over: Record<string, unknown> = {}) {
  return {
    id: "cl1",
    title: "Garantia — fiador",
    content: "O FIADOR responde solidariamente pelo aluguel.",
    esteira: "locacao",
    groupCode: null,
    tags: ["slot:garantia", "garantia:fiador"],
    chunkTotal: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reviewClauseLibrary", () => {
  it("cláusula íntegra passa e não vira linha de problema", async () => {
    findMany.mockResolvedValue([clausula()]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.problemas).toEqual([]);
    expect(rows[0]!.slot).toBe("garantia");
  });

  it("Handlebars que não compila vira render_error — o que a geração descartaria", async () => {
    findMany.mockResolvedValue([
      clausula({ content: "{{#if garantia.tipo}}sem fechar o bloco" }),
    ]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows[0]!.ok).toBe(false);
    expect(rows[0]!.problemas[0]!.reason).toBe("render_error");
  });

  it("token de Google Doc escapado sobrevive ao render e é acusado como residual", async () => {
    // Caso real de quem copiou o texto do modelo para dentro da cláusula: o
    // `\{{...}}` compila, não lança, e sai LITERAL no PDF assinado.
    findMany.mockResolvedValue([
      clausula({ content: "Pago à corretora \\{{corretagem_qualificacao}}." }),
    ]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows[0]!.ok).toBe(false);
    expect(rows[0]!.problemas[0]!.reason).toBe("residual_placeholder");
  });

  it("row partida em chunks é acusada antes de virar preview cortado no contrato", async () => {
    findMany.mockResolvedValue([clausula({ chunkTotal: 3 })]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows[0]!.problemas[0]!.reason).toBe("chunked_content");
  });

  it("esteira null é provada nas DUAS — é onde a linha é lida (fail-open)", async () => {
    findMany.mockResolvedValue([clausula({ esteira: null })]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows[0]!.provadaEm).toEqual(["venda", "locacao"]);
  });

  it("cláusula de venda é provada só na venda", async () => {
    findMany.mockResolvedValue([clausula({ esteira: "venda" })]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows[0]!.provadaEm).toEqual(["venda"]);
  });

  it("chave que resolve para vazio é AVISO, não falha — a geração aceita", async () => {
    findMany.mockResolvedValue([
      clausula({ content: "Multa de {{contrato.multa_inexistente}} sobre o aluguel." }),
    ]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.chavesVazias).toContain("contrato.multa_inexistente");
  });

  it("caminho que EXISTE na amostra não vira aviso", async () => {
    findMany.mockResolvedValue([
      clausula({ esteira: "locacao", content: "Aluguel de {{aluguel.valor}}." }),
    ]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows[0]!.chavesVazias).toEqual([]);
  });

  it("helper e bloco não viram aviso de chave vazia (falso positivo custa a tela toda)", async () => {
    findMany.mockResolvedValue([
      clausula({
        esteira: "locacao",
        content: "{{#if aluguel.valor}}Valor: {{moeda aluguel.valor}}{{/if}}",
      }),
    ]);
    const { rows } = await reviewClauseLibrary({ orgId: "org1" });
    expect(rows[0]!.chavesVazias).toEqual([]);
  });

  it("trunca no teto e avisa, em vez de devolver o acervo inteiro", async () => {
    findMany.mockResolvedValue([clausula({ id: "a" }), clausula({ id: "b" })]);
    const { rows, truncado } = await reviewClauseLibrary({ orgId: "org1", max: 1 });
    expect(rows).toHaveLength(1);
    expect(truncado).toBe(true);
  });

  it("busca só as cláusulas APROVADAS e raiz DA ORG", async () => {
    findMany.mockResolvedValue([]);
    await reviewClauseLibrary({ orgId: "org1" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org1", category: "clause", status: "approved", parentId: null },
      })
    );
  });
});
