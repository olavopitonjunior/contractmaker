import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Unmock handlebars pra testar o render real (o setup global o stuba).
vi.unmock("@/lib/render/handlebars");

import { renderContratoHTML } from "@/lib/render/handlebars";

function loadTemplate(filename: string): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", filename),
    path.join(process.cwd(), "templates", filename),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c, "utf-8");
  throw new Error(`template ${filename} não encontrado`);
}

const TEMPLATE = loadTemplate("administracao_locacao_v1.hbs");

function render(comissao: Record<string, unknown>): string {
  return renderContratoHTML(TEMPLATE, {
    config: { taxa_admin_percent: 10 },
    comissao,
  } as never);
}

/**
 * Cláusula 5.2 do contrato de administração — a única que renderiza a taxa de
 * intermediação. Ela só sabia falar em percentual; a forma "valor fixo" da
 * imobiliária não tinha texto.
 */
describe("administracao_locacao_v1 — cláusula 5.2 (taxa de intermediação)", () => {
  it("percentual: renderiza o % e o extenso", () => {
    const html = render({
      forma_taxa_locacao: "percentual",
      taxa_locacao_percent: 100,
    });
    expect(html).toContain("5.2.");
    expect(html).toContain("100%");
    expect(html).toContain("do primeiro aluguel");
    expect(html).not.toContain("R$");
  });

  it("valor fixo: renderiza o valor em reais, sem falar em percentual", () => {
    const html = render({
      forma_taxa_locacao: "valor_fixo",
      taxa_locacao_valor: 800,
    });
    expect(html).toContain("5.2.");
    expect(html).toContain("800,00");
    expect(html).not.toContain("do primeiro aluguel");
    expect(html).not.toContain("por cento) do primeiro");
  });

  it("sem forma declarada, cai no percentual (contrato dos formulários antigos)", () => {
    const html = render({ taxa_locacao_percent: 50 });
    expect(html).toContain("50%");
    expect(html).toContain("do primeiro aluguel");
  });

  it("zerado nas duas formas: a cláusula 5.2 não sai", () => {
    expect(render({ taxa_locacao_percent: 0 })).not.toContain("5.2.");
    expect(
      render({ forma_taxa_locacao: "valor_fixo", taxa_locacao_valor: 0 })
    ).not.toContain("5.2.");
  });

  it("a taxa de administração (5.1) é independente da forma da 5.2", () => {
    const html = render({
      forma_taxa_locacao: "valor_fixo",
      taxa_locacao_valor: 800,
    });
    expect(html).toContain("5.1.");
    expect(html).toContain("10%");
  });
});
