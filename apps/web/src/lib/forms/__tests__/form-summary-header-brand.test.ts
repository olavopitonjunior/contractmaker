import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/render/exporter", () => ({ exportPdfToBuffer: vi.fn() }));

import { renderFormSummaryHtml } from "../form-summary-pdf";

/**
 * O header do PDF de resumo era neutro — nenhum resumo saía com a marca da
 * imobiliária. O logo (BrandingSettings.logoUrl) agora entra no HTML do corpo
 * (o headerTemplate do Chromium não tem rede) e a régua usa a cor primária do
 * tenant. Estes testes travam o contrato: com logo sai `<img>` escapado; sem
 * logo o header continua o de sempre; hex inválido não vaza pro <style>.
 */

const META = {
  orgName: "RE/MAX Ativa",
  formTitle: "Formulário de venda",
  generatedAtLabel: "18/08/2026 10:00",
};

describe("renderFormSummaryHtml — branding do tenant", () => {
  it("renderiza o logo escapado e a cor primária no border", () => {
    const html = renderFormSummaryHtml([], {
      ...META,
      logoUrl: 'https://blob/logo.png?x="1"',
      primaryColor: "#DC1C2E",
    });
    expect(html).toContain(
      '<img class="fs-logo" src="https://blob/logo.png?x=&quot;1&quot;"'
    );
    expect(html).toContain('alt="RE/MAX Ativa"');
    expect(html).toContain("border-bottom: 2px solid #DC1C2E");
  });

  it("sem logoUrl não emite <img> e mantém o nome da org na meta", () => {
    const html = renderFormSummaryHtml([], META);
    expect(html).not.toContain("<img");
    expect(html).toContain("RE/MAX Ativa · Gerado em");
  });

  it("primaryColor inválida/ausente cai no #1a1a1a original", () => {
    const semCor = renderFormSummaryHtml([], META);
    expect(semCor).toContain("border-bottom: 2px solid #1a1a1a");

    const corInvalida = renderFormSummaryHtml([], {
      ...META,
      primaryColor: "red; } body { display: none",
    });
    expect(corInvalida).toContain("border-bottom: 2px solid #1a1a1a");
    expect(corInvalida).not.toContain("display: none");
  });
});
