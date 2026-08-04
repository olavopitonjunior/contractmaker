import { describe, it, expect, beforeAll, vi } from "vitest";
import { checkProposalContent } from "../clicksign-readiness";
import { buildProposalDataJson, type ProposalFormValues } from "../form-data";

/**
 * O que a tool MCP monta tem de ser a MESMA forma que a UI produz.
 *
 * A UI e o agente escrevem o mesmo `dataJson`, lido pelo mesmo template. Enquanto
 * o agente montava o objeto por conta própria, ele divergia a cada chamada e o
 * PDF saía vazio. Agora quem monta é `buildProposalPayload`; este teste é o que
 * impede os dois lados de divergirem de novo.
 */

vi.mock("../../../../../mcp-server/src/index.js", () => ({
  callApi: vi.fn(),
  callBridge: vi.fn(),
  logProactiveOutbound: vi.fn(),
}));

type Build = (args: Record<string, unknown>) => {
  ok: boolean;
  message?: string;
  body?: Record<string, unknown>;
};
let buildProposalPayload: Build;

beforeAll(async () => {
  const mod = await import("../../../../../mcp-server/src/proposal-payload.js");
  buildProposalPayload = mod.buildProposalPayload as Build;
});

const ARGS_MINIMO = {
  schemaType: "compra_venda_v1",
  proponente: { nome: "Patrícia Andrade", telefone: "11970325533" },
  imovel: { endereco: "Rua Senador Godói, 606" },
  valor: 1000000,
  canal: "whatsapp",
};

function uiEquivalente(): Record<string, unknown> {
  const v = {
    kind: "venda",
    schemaType: "compra_venda_v1",
    proponentes: [
      {
        tipoPessoa: "fisica",
        nome: "Patrícia Andrade",
        documento: "",
        email: "",
        phone: "11970325533",
        canal: "whatsapp",
      },
    ],
    vendedores: [],
    imovelEndereco: "Rua Senador Godói, 606",
    ilistSnapshot: null,
    valor: "1.000.000,00",
    validadeDias: "7",
    comissao: false,
    esconderComissao: false,
    garantia: { tipo: "sem_garantia" },
    witnesses: [],
  } as unknown as ProposalFormValues;
  return buildProposalDataJson(v);
}

describe("paridade tool MCP ↔ forma canônica da UI", () => {
  it("monta compradores/imoveis/pagamento como a UI", () => {
    const out = buildProposalPayload(ARGS_MINIMO);
    expect(out.ok).toBe(true);
    const data = out.body!.dataJson as Record<string, unknown>;
    const ui = uiEquivalente();

    expect(data.imoveis).toEqual(ui.imoveis);
    expect(data.pagamento).toEqual(ui.pagamento);
    // `compradores` tem o mesmo shape de `partyToData` — inclusive `telefone`.
    expect(Object.keys(data.compradores as object[])).toEqual(
      Object.keys(ui.compradores as object[])
    );
    expect((data.compradores as Array<Record<string, unknown>>)[0]).toEqual(
      (ui.compradores as Array<Record<string, unknown>>)[0]
    );
  });

  it("o que a tool monta passa no check de conteúdo do envio", () => {
    const out = buildProposalPayload(ARGS_MINIMO);
    expect(checkProposalContent("compra_venda_v1", out.body!.dataJson)).toEqual([]);
  });

  it("gera título sozinho quando não vem", () => {
    const out = buildProposalPayload(ARGS_MINIMO);
    expect(out.body!.title).toContain("Patrícia Andrade");
    expect(out.body!.title).toContain("Rua Senador Godói, 606");
  });

  it("um único signatário quando não há vendedor", () => {
    const out = buildProposalPayload(ARGS_MINIMO);
    const signers = out.body!.signers as Array<Record<string, unknown>>;
    expect(signers).toHaveLength(1);
    expect(signers[0]).toMatchObject({ role: "proponente", notifyChannel: "whatsapp" });
  });
});

describe("o mínimo obrigatório, em linguagem de corretor", () => {
  it.each([
    [{ ...ARGS_MINIMO, proponente: { nome: "Patrícia", telefone: "11970325533" } }, "nome completo"],
    [{ ...ARGS_MINIMO, imovel: {} }, "endereço"],
    [{ ...ARGS_MINIMO, valor: undefined }, "valor"],
    [{ ...ARGS_MINIMO, canal: "" }, "WhatsApp ou por e-mail"],
    [{ ...ARGS_MINIMO, proponente: { nome: "Patrícia Andrade" } }, "telefone"],
    [
      { ...ARGS_MINIMO, canal: "email", proponente: { nome: "Patrícia Andrade" } },
      "e-mail",
    ],
  ])("recusa e explica: %#", (args, esperado) => {
    const out = buildProposalPayload(args as Record<string, unknown>);
    expect(out.ok).toBe(false);
    expect(out.message).toContain(esperado);
    // Nunca jargão: quem lê é corretor.
    expect(out.message).not.toMatch(/dataJson|schemaType|signers|notifyChannel|null/);
  });
});

describe("vendedor — o fantasma que travou três envios", () => {
  it("sem contato: recusa e oferece seguir só com o proponente", () => {
    const out = buildProposalPayload({
      ...ARGS_MINIMO,
      vendedor: { nome: "Júnior Garrido" },
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain("Júnior Garrido");
    expect(out.message).toContain("só para Patrícia Andrade");
  });

  it("com telefone: entra como 2º signatário por WhatsApp", () => {
    const out = buildProposalPayload({
      ...ARGS_MINIMO,
      vendedor: { nome: "Júnior Garrido", telefone: "13997826692" },
    });
    expect(out.ok).toBe(true);
    const signers = out.body!.signers as Array<Record<string, unknown>>;
    expect(signers).toHaveLength(2);
    expect(signers[1]).toMatchObject({ role: "vendedor", notifyChannel: "whatsapp" });
    expect((out.body!.dataJson as Record<string, unknown>).vendedores).toHaveLength(1);
  });

  it("nunca inventa vendedor quando não foi informado", () => {
    const out = buildProposalPayload(ARGS_MINIMO);
    expect((out.body!.dataJson as Record<string, unknown>).vendedores).toEqual([]);
  });
});

describe("comissão", () => {
  it("sem número, não liga comissaoIncluida (o template imprimiria 'com comissão .')", () => {
    const out = buildProposalPayload({ ...ARGS_MINIMO, comissao: {} });
    expect(out.body!.comissaoIncluida).toBe(false);
    expect((out.body!.dataJson as Record<string, unknown>).comissao).toBeUndefined();
  });

  it("com percentual, liga e grava no caminho que o template lê", () => {
    const out = buildProposalPayload({ ...ARGS_MINIMO, comissao: { percentual: 6 } });
    expect(out.body!.comissaoIncluida).toBe(true);
    expect((out.body!.dataJson as Record<string, unknown>).comissao).toEqual({ percentual: 6 });
  });
});

describe("escape hatch", () => {
  it("dataJson extra complementa, mas não sobrescreve o canônico", () => {
    const out = buildProposalPayload({
      ...ARGS_MINIMO,
      dataJson: { compradores: [{ nome: "Invasor" }], observacoes: "texto livre" },
    });
    const data = out.body!.dataJson as Record<string, unknown>;
    expect((data.compradores as Array<Record<string, unknown>>)[0].nome).toBe("Patrícia Andrade");
    expect(data.observacoes).toBe("texto livre");
  });
});
