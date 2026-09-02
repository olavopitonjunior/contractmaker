import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockBatchUpdate } = vi.hoisted(() => ({ mockBatchUpdate: vi.fn() }));

vi.mock("@/lib/google/client", () => ({
  getDocsClient: () => ({ documents: { batchUpdate: mockBatchUpdate } }),
}));
vi.mock("@/lib/google/doc-edit-marker", () => ({
  markProgrammaticDocEdit: vi.fn(),
}));

import { replacePlaceholdersInDoc } from "../replace-placeholders";

beforeEach(() => vi.clearAllMocks());

describe("replacePlaceholdersInDoc — contrato de leitura das replies", () => {
  it("valor VAZIO ainda gera request e ainda conta ocorrência — é disso que o laudo de preenchimento depende", async () => {
    // A API do Docs conta `occurrencesChanged` por match, independente do
    // replaceText. Este teste fixa como o módulo LÊ as replies (2 por token:
    // sem espaço + com espaço); o comportamento da API em si é premissa
    // documentada aqui, não provada — se um dia mudar, é este teste que
    // aponta onde o laudo passa a ter falso negativo.
    mockBatchUpdate.mockResolvedValue({
      data: {
        replies: [
          { replaceAllText: { occurrencesChanged: 2 } }, // {{aluguel_valor}}
          { replaceAllText: { occurrencesChanged: 0 } }, // {{ aluguel_valor }}
          { replaceAllText: { occurrencesChanged: 1 } }, // {{imovel_identificacao}} → ""
          { replaceAllText: { occurrencesChanged: 1 } }, // {{ imovel_identificacao }} → ""
          { replaceAllText: {} }, // token ausente do doc: reply sem contagem
          { replaceAllText: {} },
        ],
      },
    });
    const out = await replacePlaceholdersInDoc({
      docId: "d1",
      replacements: { aluguel_valor: "R$ 1,00", imovel_identificacao: "", clausula_x: "y" },
    });
    const requests = mockBatchUpdate.mock.calls[0][0].requestBody.requests;
    expect(requests).toHaveLength(6);
    expect(requests[2].replaceAllText.replaceText).toBe("");
    expect(out.occurrencesByToken).toEqual({
      aluguel_valor: 2,
      imovel_identificacao: 2,
      clausula_x: 0,
    });
  });

  it("mapa vazio não chama a API", async () => {
    const out = await replacePlaceholdersInDoc({ docId: "d1", replacements: {} });
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(out).toEqual({ totalRequests: 0, occurrencesByToken: {} });
  });
});
