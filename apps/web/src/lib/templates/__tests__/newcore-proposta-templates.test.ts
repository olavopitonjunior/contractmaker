import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// O setup global mocka o Handlebars (`<rendered>{json}</rendered>`) pra isolar
// testes de rota; aqui o RENDER REAL é o objeto do teste.
vi.unmock("@/lib/render/handlebars");

import { buildTemplatePreviewHtml, resolvePreviewFixture } from "../preview-context";

/**
 * Templates de proposta do tenant Newcore (templates/tenants/newcore/*.hbs):
 * renderiza cada modalidade com a amostra oficial do preview e garante que o
 * Handlebars compila, que nenhum placeholder cru sobra no HTML e que os blocos
 * centrais saíram. É o mesmo caminho do POST /api/templates/[id]/preview.
 */
const TENANT_DIR = path.join(__dirname, "../../../../../..", "templates/tenants/newcore");

function render(file: string, modalidade: string): string {
  const source = fs.readFileSync(path.join(TENANT_DIR, file), "utf-8");
  return buildTemplatePreviewHtml({
    handlebarsSource: source,
    modalidade,
    fixture: resolvePreviewFixture(modalidade, undefined),
  });
}

describe("templates de proposta Newcore", () => {
  it("proposta_venda_v1 renderiza sem placeholder cru", () => {
    const html = render("proposta_venda_v1.hbs", "proposta_venda");
    expect(html).toContain("PROPOSTA DE COMPRA E VENDA DE IMÓVEL");
    expect(html).toContain("Proponente comprador");
    expect(html).toContain("CONDIÇÕES ESSENCIAIS");
    expect(html).toContain("artigos 722 a 729");
    // Datas de amostra do preview-context (data_emissao/validade_ate).
    expect(html).toContain("Emitida em 01/08/2026");
    expect(html).toContain("até 08/08/2026");
    expect(html).not.toMatch(/\{\{/);
  });

  it.each([
    ["proposta_locacao_residencial"],
    ["proposta_locacao_comercial"],
  ])("proposta_locacao_v1 renderiza %s sem placeholder cru", (modalidade) => {
    const html = render("proposta_locacao_v1.hbs", modalidade);
    expect(html).toContain("PROPOSTA DE LOCAÇÃO DE IMÓVEL");
    expect(html).toContain("Proponente locatário");
    expect(html).toContain("Lei nº 8.245/91");
    expect(html).toContain("aprovação cadastral");
    expect(html).not.toMatch(/\{\{/);
  });
});
