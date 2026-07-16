import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { unsetByPath, buildViaContext, renderProposalVia } from "../render";
import { sanitizeHiddenPaths, hidesComissao } from "../hidden-fields";

// O setup global mocka renderContratoHTML (devolve JSON). Aqui a asserção
// central é sobre o HTML REAL, então usamos o Handlebars de verdade.
vi.unmock("@/lib/render/handlebars");

const VENDA = {
  compradores: [{ nome: "Marcia Souza", cpf: "12345678900", email: "m@x.com", renda: 18000 }],
  vendedores: [{ nome: "Paulo Mendes" }],
  imoveis: [{ endereco: "Av. Brasil", numero: "1201", cidade: "São Paulo", uf: "SP" }],
  pagamento: { valor_total: 780000, forma: "à vista" },
  comissao: { percentual: 6, valor: 46800 },
};

const templatesDir = path.resolve(__dirname, "../../../../../../templates");
function tpl(name: string) {
  return fs.readFileSync(path.join(templatesDir, name), "utf8");
}

describe("unsetByPath — deleta a chave (não esvazia)", () => {
  it("remove chave aninhada e não muta o input", () => {
    const orig = { a: { b: 1, c: 2 } };
    const out = unsetByPath(orig, "a.b");
    expect(out.a).toEqual({ c: 2 });
    expect(orig.a).toEqual({ b: 1, c: 2 }); // input intacto
  });

  it("remove um objeto inteiro (comissao)", () => {
    const out = unsetByPath(structuredClone(VENDA), "comissao");
    expect("comissao" in out).toBe(false);
  });

  it("path inexistente é no-op silencioso", () => {
    const out = unsetByPath({ a: 1 }, "x.y.z");
    expect(out).toEqual({ a: 1 });
  });
});

describe("sanitizeHiddenPaths — allowlist por schemaType", () => {
  it("mantém só os paths previstos, descarta arbitrários", () => {
    const out = sanitizeHiddenPaths("compra_venda_v1", [
      "comissao",
      "vendedores.0.cpf", // NÃO está na allowlist → descartado
      "compradores.0.renda",
    ]);
    expect(out).toEqual(["comissao", "compradores.0.renda"]);
  });

  it("hidesComissao detecta o bloco de comissão", () => {
    expect(hidesComissao(["comissao"])).toBe(true);
    expect(hidesComissao(["comissao.valor"])).toBe(true);
    expect(hidesComissao(["compradores.0.renda"])).toBe(false);
  });
});

describe("buildViaContext — a asserção central do plano", () => {
  it("via completa mantém a comissão; via_reduzida=false", () => {
    const ctx = buildViaContext({
      schemaType: "compra_venda_v1",
      dataJson: VENDA,
      hiddenPaths: ["comissao"],
      via: "completa",
      numero: "2026-0142",
      comissaoIncluida: true,
    });
    expect(ctx.comissao).toBeTruthy();
    expect(ctx.comissao_incluida).toBe(true);
    expect(ctx.via_reduzida).toBe(false);
  });

  it("via reduzida REMOVE a comissão; via_reduzida=true", () => {
    const ctx = buildViaContext({
      schemaType: "compra_venda_v1",
      dataJson: VENDA,
      hiddenPaths: ["comissao"],
      via: "reduzida",
      numero: "2026-0142",
      comissaoIncluida: true,
    });
    expect("comissao" in ctx).toBe(false);
    expect(ctx.via_reduzida).toBe(true);
  });

  it("comissão não incluída → bloco sai do contexto mesmo sem hiddenPaths", () => {
    const ctx = buildViaContext({
      schemaType: "compra_venda_v1",
      dataJson: VENDA,
      hiddenPaths: [],
      via: "completa",
      numero: "1",
      comissaoIncluida: false,
    });
    expect(ctx.comissao_incluida).toBe(false);
    expect("comissao" in ctx).toBe(false);
  });

  it("hiddenPath fora da allowlist NÃO é removido (defesa em profundidade)", () => {
    const ctx = buildViaContext({
      schemaType: "compra_venda_v1",
      dataJson: VENDA,
      hiddenPaths: ["vendedores.0.nome"], // não permitido
      via: "reduzida",
      numero: "1",
      comissaoIncluida: true,
    });
    expect((ctx.vendedores as { nome: string }[])[0].nome).toBe("Paulo Mendes");
  });
});

describe("render dos templates .hbs", () => {
  it("venda: a via do vendedor NÃO contém a comissão que a completa contém", () => {
    const source = tpl("proposta_venda_v1.hbs");
    const args = {
      templateSource: source,
      schemaType: "compra_venda_v1",
      dataJson: VENDA,
      hiddenPaths: ["comissao"],
      numero: "2026-0142",
    } as const;

    const completa = renderProposalVia({ ...args, via: "completa", comissaoIncluida: true });
    const reduzida = renderProposalVia({ ...args, via: "reduzida", comissaoIncluida: true });

    // O valor da comissão aparece na completa e some na reduzida.
    expect(completa).toContain("Intermediação");
    expect(completa).toMatch(/6.*%/);
    expect(reduzida).not.toContain("Intermediação");

    // A via reduzida traz a cláusula de extrato; a completa não.
    expect(reduzida).toContain("reproduz as condições essenciais da Proposta nº 2026-0142");
    expect(completa).not.toContain("reproduz as condições essenciais");

    // Sem buracos: nada de "% sobre o valor" solto sem o número.
    expect(reduzida).not.toContain("sobre o valor da venda");
  });

  it("comissão não incluída → seção some, uma via só faz sentido", () => {
    const source = tpl("proposta_venda_v1.hbs");
    const html = renderProposalVia({
      templateSource: source,
      schemaType: "compra_venda_v1",
      dataJson: VENDA,
      hiddenPaths: [],
      via: "completa",
      numero: "1",
      comissaoIncluida: false,
    });
    expect(html).not.toContain("Intermediação");
    expect(html).toContain("Marcia Souza");
  });

  it("os 3 templates renderizam sem erro de Handlebars", () => {
    for (const [name, schema, data] of [
      ["proposta_venda_v1.hbs", "compra_venda_v1", VENDA],
      [
        "proposta_locacao_residencial_v1.hbs",
        "locacao_residencial_v1",
        {
          locatarios: [{ nome: "Ana" }],
          locadores: [{ nome: "José" }],
          imoveis: [{ endereco: "R. Sete" }],
          locacao: { valor_aluguel: 3200, prazo_meses: 30 },
        },
      ],
      [
        "proposta_locacao_comercial_v1.hbs",
        "locacao_comercial_v1",
        {
          locatarios: [{ nome: "Loja X Ltda", cnpj: "12345678000199" }],
          locadores: [{ nome: "José" }],
          imoveis: [{ endereco: "Al. Santos" }],
          locacao: { valor_aluguel: 8000, destinacao: "comércio varejista" },
        },
      ],
    ] as const) {
      const html = renderProposalVia({
        templateSource: tpl(name),
        schemaType: schema,
        dataJson: data as Record<string, unknown>,
        hiddenPaths: [],
        via: "completa",
        numero: "1",
      });
      expect(html.length).toBeGreaterThan(100);
    }
  });
});
