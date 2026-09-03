import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A prévia copia um Doc, preenche e exporta. Dois riscos, e os dois têm dono
 * aqui: a cópia sobreviver no Drive da imobiliária (um documento com cara de
 * contrato que ninguém sabe de onde veio) e a prévia divergir da geração (o
 * operador aprova o modelo confiando num resultado que não é o que sai).
 */
const copyMock = vi.fn();
const trashMock = vi.fn();
const replaceMock = vi.fn();
const cleanupMock = vi.fn();
const exportMock = vi.fn();
const headRevisionMock = vi.fn();

vi.mock("@/lib/google/copy-doc", () => ({
  copyContractGoogleDoc: (...a: unknown[]) => copyMock(...a),
}));
vi.mock("@/lib/google/org-oauth", () => ({
  trashDriveFile: (...a: unknown[]) => trashMock(...a),
}));
vi.mock("@/lib/google/replace-placeholders", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  replacePlaceholdersInDoc: (...a: unknown[]) => replaceMock(...a),
}));
vi.mock("@/lib/google/docs", () => ({
  cleanupOrphanPlaceholders: (...a: unknown[]) => cleanupMock(...a),
  exportDocAsHtml: (...a: unknown[]) => exportMock(...a),
  getDocHeadRevision: (...a: unknown[]) => headRevisionMock(...a),
}));

import { renderGoogleDocsPreview } from "../gdoc-preview";

const input = (over: Record<string, unknown> = {}) => ({
  templateId: `tpl-${Math.random().toString(36).slice(2)}`,
  orgId: "org1",
  docId: "doc-modelo",
  modalidade: "locacao",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  copyMock.mockResolvedValue({ docId: "copia1", webViewLink: "http://x" });
  replaceMock.mockResolvedValue({ occurrencesByToken: {} });
  cleanupMock.mockResolvedValue([]);
  exportMock.mockResolvedValue("<html>contrato preenchido</html>");
  headRevisionMock.mockResolvedValue("rev-1");
  trashMock.mockResolvedValue(undefined);
});

describe("renderGoogleDocsPreview", () => {
  it("copia, preenche, exporta e DESCARTA a cópia", async () => {
    const out = await renderGoogleDocsPreview(input());
    expect(out.html).toContain("contrato preenchido");
    expect(out.cached).toBe(false);
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(trashMock).toHaveBeenCalledWith("copia1", "org1");
  });

  it("descarta a cópia MESMO quando o export falha", async () => {
    exportMock.mockRejectedValue(new Error("Drive fora"));
    await expect(renderGoogleDocsPreview(input())).rejects.toThrow("Drive fora");
    // Sem isto, cada falha deixaria um Doc órfão no Drive da imobiliária.
    expect(trashMock).toHaveBeenCalledWith("copia1", "org1");
  });

  it("preenche pelo mapa da GERAÇÃO — a chave do rateio sai com valor, não crua", async () => {
    await renderGoogleDocsPreview(input());
    const map = replaceMock.mock.calls[0][0].replacements as Record<string, string>;
    // Se a prévia montasse um mapa próprio, divergiria da geração sem avisar.
    expect(map).toHaveProperty("rateio_primeiro_aluguel");
    expect(map).toHaveProperty("corretagem_qualificacao");
    expect(map).toHaveProperty("imobiliaria_dados_pagamento");
    expect(map.locadores_qualificacao).toBeTruthy();
    expect(map.contrato_numero).toBe("EXEMPLO-0001");
  });

  it("mesma revisão do Doc serve do cache, sem copiar de novo", async () => {
    const args = input();
    await renderGoogleDocsPreview(args);
    const segunda = await renderGoogleDocsPreview(args);
    expect(segunda.cached).toBe(true);
    expect(copyMock).toHaveBeenCalledTimes(1);
  });

  it("revisão nova invalida o cache — prévia velha parece confirmação", async () => {
    const args = input();
    await renderGoogleDocsPreview(args);
    headRevisionMock.mockResolvedValue("rev-2");
    const segunda = await renderGoogleDocsPreview(args);
    expect(segunda.cached).toBe(false);
    expect(copyMock).toHaveBeenCalledTimes(2);
  });

  it("sem revisão do Drive não usa cache: 'não sei' não vira 'serve'", async () => {
    headRevisionMock.mockRejectedValue(new Error("sem permissão"));
    const args = input();
    await renderGoogleDocsPreview(args);
    await renderGoogleDocsPreview(args);
    expect(copyMock).toHaveBeenCalledTimes(2);
  });

  it("modelo de VENDA usa o mapa de venda, não o de locação", async () => {
    // Rodar o mapa de locação sobre dados de venda não daria erro: daria um
    // mapa quase vazio, e o `cleanupOrphanPlaceholders` apagaria em silêncio as
    // chaves que o modelo tem — uma prévia limpa e ERRADA, que é o defeito que
    // esta tela existe para não repetir.
    await renderGoogleDocsPreview(input({ modalidade: "a_vista" }));
    const map = replaceMock.mock.calls[0][0].replacements as Record<string, string>;
    expect(map.vendedores_qualificacao).toBeTruthy();
    // Chaves que só existem em locação não podem aparecer num modelo de venda.
    expect(map.locadores_qualificacao).toBeUndefined();
    expect(map.rateio_primeiro_aluguel).toBeUndefined();
  });

  it("família sem construtor de mapa recusa em vez de inventar prévia", async () => {
    await expect(
      renderGoogleDocsPreview(input({ modalidade: "proposta_venda" }))
    ).rejects.toMatchObject({ name: "PreviewFamiliaNaoSuportadaError" });
    // Recusado ANTES de copiar: nada é criado no Drive.
    expect(copyMock).not.toHaveBeenCalled();
  });

  it("mudar o Perfil da org invalida o cache — a conta dela sai impressa na prévia", async () => {
    const args = input({ orgRecebimento: { pix_chave: "antiga@exemplo.test" } as never });
    await renderGoogleDocsPreview(args);
    const depois = await renderGoogleDocsPreview({
      ...args,
      orgRecebimento: { pix_chave: "nova@exemplo.test" } as never,
    });
    expect(depois.cached).toBe(false);
    expect(copyMock).toHaveBeenCalledTimes(2);
  });

  it("dois pedidos simultâneos geram UMA cópia só", async () => {
    const args = input();
    const [a, b] = await Promise.all([
      renderGoogleDocsPreview(args),
      renderGoogleDocsPreview(args),
    ]);
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(a.html).toBe(b.html);
  });
});
