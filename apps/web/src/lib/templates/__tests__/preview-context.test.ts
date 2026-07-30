import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildTemplatePreviewContext,
  buildTemplatePreviewHtml,
  resolvePreviewFixture,
} from "../preview-context";

// O setup global mocka `renderContratoHTML` (devolve JSON). Aqui o ponto é o
// HTML de verdade — o preview é exatamente esse render.
vi.unmock("@/lib/render/handlebars");

const templatesDir = path.resolve(__dirname, "../../../../../../templates");
function tpl(name: string) {
  return fs.readFileSync(path.join(templatesDir, name), "utf8");
}

describe("resolvePreviewFixture — o body não escolhe schema", () => {
  it("venda aceita as duas amostras do grupo", () => {
    expect(resolvePreviewFixture("a_vista", "financiamento")).toBe("financiamento");
    expect(resolvePreviewFixture("financiamento", "a_vista")).toBe("a_vista");
  });

  it("proposta ignora fixture de venda e usa a própria modalidade", () => {
    // Era o bug das abas hardcoded: o diálogo mandava "a_vista" pra um template
    // de proposta e a rota renderizava o schema de venda (documento vazio).
    expect(resolvePreviewFixture("proposta_locacao_residencial", "a_vista")).toBe(
      "proposta_locacao_residencial"
    );
    expect(resolvePreviewFixture("locacao_comercial", "financiamento")).toBe(
      "locacao_comercial"
    );
  });

  it("fixture ausente ou lixo cai no primeiro da modalidade", () => {
    expect(resolvePreviewFixture("a_vista", undefined)).toBe("a_vista");
    expect(resolvePreviewFixture("a_vista", { nope: 1 })).toBe("a_vista");
  });
});

describe("buildTemplatePreviewContext — enrich por família", () => {
  it("venda materializa o vocabulário de compra e venda", () => {
    const ctx = buildTemplatePreviewContext("a_vista", "a_vista");
    const config = ctx.config as Record<string, unknown>;
    expect(config.multa_penal_moratoria).toBe(2);
    expect(Array.isArray(ctx.vendedores)).toBe(true);
  });

  it("locação usa o enrich de locação (nada de venda vaza)", () => {
    const ctx = buildTemplatePreviewContext("locacao", "locacao");
    const config = ctx.config as Record<string, unknown>;
    expect(config.multa_atraso_percent).toBe(10);
    expect(config.prazo_escritura_dias).toBeUndefined();
    expect(Array.isArray(ctx.locadores)).toBe(true);
  });

  it("administracao_locacao é LOCAÇÃO, não venda", () => {
    // Regressão: a rota decidia por `modalidade.startsWith("locacao")`, e
    // "administracao_locacao" não começa com "locacao" (é deliberado) — esses
    // templates recebiam a amostra de venda e renderizavam em branco.
    const ctx = buildTemplatePreviewContext("administracao_locacao", "administracao_locacao");
    const config = ctx.config as Record<string, unknown>;
    expect(Array.isArray(ctx.locadores)).toBe(true);
    expect(ctx.compradores).toBeUndefined();
    expect(config.taxa_admin_percent).toBe(10);
    expect(config.repasse_texto).toBeTruthy();
  });

  it("proposta traz numero_proposta / via_reduzida / comissao_incluida", () => {
    const ctx = buildTemplatePreviewContext("proposta_venda", "proposta_venda");
    expect(ctx.numero_proposta).toBe("0001");
    expect(ctx.via_reduzida).toBe(false);
    expect(ctx.comissao_incluida).toBe(true);
  });

  it("proposta de locação usa o enrich de locação", () => {
    const ctx = buildTemplatePreviewContext(
      "proposta_locacao_residencial",
      "proposta_locacao_residencial"
    );
    const config = ctx.config as Record<string, unknown>;
    expect(config.multa_atraso_percent).toBe(10);
    expect(config.multa_penal_moratoria).toBeUndefined();
    expect(Array.isArray(ctx.locatarios)).toBe(true);
  });
});

describe("buildTemplatePreviewHtml — render real dos canônicos", () => {
  const cases: Array<[string, string, string]> = [
    ["ccv_a_vista_v2.hbs", "a_vista", "a_vista"],
    ["ccv_financiamento_v2.hbs", "financiamento", "financiamento"],
    ["locacao_residencial_v3.hbs", "locacao", "locacao"],
    ["locacao_comercial_v3.hbs", "locacao_comercial", "locacao_comercial"],
    ["administracao_locacao_v1.hbs", "administracao_locacao", "administracao_locacao"],
    ["proposta_venda_v1.hbs", "proposta_venda", "proposta_venda"],
    [
      "proposta_locacao_residencial_v1.hbs",
      "proposta_locacao_residencial",
      "proposta_locacao_residencial",
    ],
    [
      "proposta_locacao_comercial_v1.hbs",
      "proposta_locacao_comercial",
      "proposta_locacao_comercial",
    ],
  ];

  it.each(cases)("%s renderiza documento com conteúdo", (file, modalidade, fixture) => {
    const html = buildTemplatePreviewHtml({
      handlebarsSource: tpl(file),
      modalidade,
      fixture,
    });
    expect(html.length).toBeGreaterThan(500);
    // Nenhum placeholder órfão do Handlebars sobrando.
    expect(html).not.toMatch(/\{\{/);
  });

  it("à vista e financiamento produzem documentos diferentes do MESMO source", () => {
    const source = tpl("ccv_a_vista_v2.hbs");
    const aVista = buildTemplatePreviewHtml({
      handlebarsSource: source,
      modalidade: "a_vista",
      fixture: "a_vista",
    });
    const fin = buildTemplatePreviewHtml({
      handlebarsSource: source,
      modalidade: "a_vista",
      fixture: "financiamento",
    });
    expect(aVista).not.toBe(fin);
  });

  it("sanitiza conteúdo ativo antes de devolver (o iframe é a 2ª camada)", () => {
    const html = buildTemplatePreviewHtml({
      handlebarsSource:
        "<div onclick=\"steal()\"><script>alert(1)</script>{{vendedores.0.nome}}</div>",
      modalidade: "a_vista",
      fixture: "a_vista",
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("João Silva Santos");
  });
});
