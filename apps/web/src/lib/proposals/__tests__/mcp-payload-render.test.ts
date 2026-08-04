import { describe, it, expect, beforeAll, vi } from "vitest";
import { renderProposalVia } from "../render";
import { CANONICAL_TEMPLATE_SOURCES } from "@/lib/templates/canonical-sources.generated";

/**
 * O ciclo completo: o que a tool MCP monta tem de aparecer NO DOCUMENTO.
 *
 * Os testes de forma (payload ↔ Zod, payload ↔ checkProposalContent) provam que
 * o corpo é aceito. Este prova o que importa pro corretor: o PDF sai com
 * proponente, imóvel e valor VISÍVEIS. Foi a verificação que faltou em
 * 2026-08-04 — todos os checks passavam e o documento ia vazio, porque ninguém
 * renderizava o resultado.
 */

vi.mock("../../../../../mcp-server/src/index.js", () => ({
  callApi: vi.fn(),
  callBridge: vi.fn(),
  logProactiveOutbound: vi.fn(),
}));

// O setup global mocka o Handlebars (`<rendered>{json}</rendered>`) porque a
// maioria dos testes só quer saber QUE renderizou. Aqui o motor real é o
// próprio objeto do teste — sem ele, o dataJson errado "contém" o nome no JSON
// serializado e o teste de regressão passa por motivo falso.
vi.unmock("@/lib/render/handlebars");

type Build = (args: Record<string, unknown>) => {
  ok: boolean;
  body?: Record<string, unknown>;
};
let buildProposalPayload: Build;

beforeAll(async () => {
  const mod = await import("../../../../../mcp-server/src/proposal-payload.js");
  buildProposalPayload = mod.buildProposalPayload as Build;
});

const TEMPLATE = CANONICAL_TEMPLATE_SOURCES["proposta_venda_v1.hbs"];

function render(dataJson: Record<string, unknown>, comissaoIncluida = false): string {
  return renderProposalVia({
    templateSource: TEMPLATE,
    schemaType: "compra_venda_v1",
    dataJson,
    hiddenPaths: [],
    via: "completa",
    numero: "TESTE123",
    comissaoIncluida,
  });
}

describe("payload da tool → template real → documento legível", () => {
  it("proponente, imóvel e valor aparecem no HTML", () => {
    const out = buildProposalPayload({
      schemaType: "compra_venda_v1",
      proponente: { nome: "Patrícia Andrade", telefone: "11970325533" },
      imovel: { endereco: "Rua Senador Godói, 606", cidade: "São Paulo", uf: "SP" },
      valor: 1000000,
      canal: "whatsapp",
      comissao: { percentual: 6 },
      pagamento: { forma: "à vista" },
    });
    expect(out.ok).toBe(true);
    const body = out.body!;
    const html = render(
      body.dataJson as Record<string, unknown>,
      body.comissaoIncluida as boolean
    );

    expect(html).toContain("Patrícia Andrade");
    expect(html).toContain("Rua Senador Godói, 606");
    expect(html).toContain("São Paulo/SP");
    // {{moeda 1000000}} → R$ 1.000.000,00 (asserção parcial pra não acoplar ao símbolo)
    expect(html).toContain("1.000.000,00");
    expect(html).toContain("6% sobre o valor da venda");
    expect(html).toContain("à vista");
    // Nada de moldura quebrada.
    expect(html).not.toContain("com comissão .");
    expect(html).not.toContain("Imóvel: .");
  });

  it("REGRESSÃO: o dataJson real do incidente renderiza SEM os dados — era isto que saía", () => {
    // Forma que o agente inventou em 04/08 (proposta cmsev8l0b…, enviada).
    const html = render({
      valor: 1000000,
      imovel: { endereco: { numero: "606", logradouro: "Rua Senador Godói" } },
      partes: { proponente: { nome: "Patrícia Andrade", phone: "11 9812 68060" } },
      pagamento: { forma: "pagamento no ato da escritura", condicao: "à vista" },
    });

    // O documento que foi assinado NÃO tinha nem o nome, nem o endereço, nem o valor.
    expect(html).not.toContain("Patrícia Andrade");
    expect(html).not.toContain("Rua Senador Godói");
    expect(html).not.toContain("1.000.000");
  });

  it("sem comissão informada, a seção de intermediação não existe", () => {
    const out = buildProposalPayload({
      schemaType: "compra_venda_v1",
      proponente: { nome: "Patrícia Andrade", telefone: "11970325533" },
      imovel: { endereco: "Rua Senador Godói, 606" },
      valor: 1000000,
      canal: "whatsapp",
    });
    const html = render(
      out.body!.dataJson as Record<string, unknown>,
      out.body!.comissaoIncluida as boolean
    );
    expect(html).not.toContain("Intermediação");
  });
});
