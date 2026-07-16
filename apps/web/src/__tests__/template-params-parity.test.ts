import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Render real (setup.ts mocka renderContratoHTML globalmente).
vi.unmock("@/lib/render/handlebars");

import { enrichContractData } from "@/lib/services/contract-generation";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { DEFAULT_CONTRACT_SETTINGS } from "@/lib/contracts/default-config";
import {
  previewSampleDataAVista,
  previewSampleDataFinanciamento,
} from "@/lib/templates/preview-sample-data";

/**
 * Trava da parametrização das cláusulas (multas, juros, prazos, índice).
 *
 * Esses números viviam ESCRITOS À MÃO no texto dos templates v2 — os campos de
 * `config` eram coletados no form e ignorados. Ao transformá-los em variáveis,
 * o risco é silenciosamente MUDAR o contrato: os defaults do form antigo
 * divergiam do texto praticado (compensatória 10% × 5% da cláusula, multa
 * diária R$ 150 × R$ 500,00, purgação 10 × 15 dias). Adotá-los teria dobrado
 * as perdas e danos de todo contrato novo.
 *
 * Por isso `DEFAULT_CONTRACT_SETTINGS` foi alinhado ao texto que já era
 * praticado, e estes casos provam que, com o padrão de fábrica, o contrato
 * renderiza exatamente o que renderizava antes.
 */
function templatePath(filename: string): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", filename),
    path.join(process.cwd(), "templates", filename),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error(`Template não encontrado: ${filename}`);
}

function render(file: string, sample: unknown, defaults = DEFAULT_CONTRACT_SETTINGS) {
  const tpl = readFileSync(templatePath(file), "utf-8");
  const data = JSON.parse(JSON.stringify(sample)) as Record<string, unknown>;
  // Simula o form novo: estes campos não são mais coletados.
  delete data.config;
  delete data.foro;
  delete data.desistencia;
  return renderContratoHTML(
    tpl,
    enrichContractData(data, { contractDefaults: defaults }) as Record<string, unknown>
  );
}

/** Como `render`, mas também sem `assinatura` — o form não a coleta mais. */
function renderSemAssinatura(file: string, sample: unknown) {
  const tpl = readFileSync(templatePath(file), "utf-8");
  const data = JSON.parse(JSON.stringify(sample)) as Record<string, unknown>;
  delete data.config;
  delete data.foro;
  delete data.desistencia;
  delete data.assinatura;
  return renderContratoHTML(
    tpl,
    enrichContractData(data) as Record<string, unknown>
  );
}

/** `moeda` usa NBSP depois do "R$" (como todo valor do contrato). */
const norm = (s: string) => s.replace(/ /g, " ");

describe("parametrização das cláusulas preserva o texto praticado", () => {
  it("À Vista: cláusulas 8 e 9 idênticas ao que era hardcoded", () => {
    const html = norm(render("ccv_a_vista_v2.hbs", previewSampleDataAVista));

    expect(html).toContain(
      "Multa moratória de 2% (dois por cento) sobre o valor da obrigação inadimplida;"
    );
    expect(html).toContain(
      "Juros moratórios de 1% (um por cento) ao mês"
    );
    expect(html).toContain("Correção monetária pelo IPCA/IBGE desde a data do vencimento.");
    expect(html).toContain(
      "Transcorrido o prazo de 15 (quinze) dias sem a purgação da mora"
    );
    expect(html).toContain(
      "prazo adicional de 15 (quinze) dias para purgação da mora"
    );
    expect(html).toContain(
      "reterão 5% (cinco por cento) do valor total do contrato a título de perdas e danos pré-fixadas, devolvendo o saldo remanescente em até 30 (trinta) dias."
    );
    expect(html).toContain(
      "acrescidos de 5% (cinco por cento) do valor total do contrato a título de perdas e danos pré-fixadas, no prazo de 30 (trinta) dias."
    );
    expect(html).toContain(
      "multa diária de R$ 500,00 (quinhentos reais), além dos encargos moratórios"
    );
    expect(html).toContain(
      "multa de 2% (dois por cento) sobre o valor devido, acrescida de correção monetária pelo IPCA/IBGE e juros moratórios de 1% (um por cento) ao mês."
    );
  });

  it("Financiamento: cláusulas 8 e 9 idênticas ao que era hardcoded", () => {
    const html = norm(render("ccv_financiamento_v2.hbs", previewSampleDataFinanciamento));

    expect(html).toContain(
      "multa moratória de 2% (dois por cento) sobre o valor da obrigação descumprida, acrescida de juros moratórios de 1% (um por cento) ao mês"
    );
    expect(html).toContain(
      "prazo de 15 (quinze) dias para a purgação da mora"
    );
    expect(html).toContain(
      "multa compensatória equivalente a 5% (cinco por cento) do valor total do contrato, podendo o(s) PROMITENTE(S) VENDEDOR(ES) reter tal quantia dos valores já pagos, devolvendo o saldo remanescente em até 30 (trinta) dias."
    );
    expect(html).toContain(
      "acrescidos de multa compensatória equivalente a 5% (cinco por cento) do valor total do contrato, no prazo de 30 (trinta) dias"
    );
  });

  it("padrão da org realmente muda as cláusulas (a feature funciona)", () => {
    const html = norm(
      render("ccv_a_vista_v2.hbs", previewSampleDataAVista, {
        ...DEFAULT_CONTRACT_SETTINGS,
        config: {
          ...DEFAULT_CONTRACT_SETTINGS.config,
          multa_penal_moratoria: 3,
          juros_mensais_atraso: 2,
          atualizacao_monetaria: "IGP-M/FGV",
          prazo_atraso_rescisao: 20,
          multa_penal_compensatoria: 8,
          multa_cominatoria_diaria: 250,
          prazo_multa_rescisoria: 45,
          base_calculo_multa: "valor da parcela",
        },
      })
    );

    expect(html).toContain("Multa moratória de 3% (três por cento) sobre o valor da parcela;");
    expect(html).toContain("Juros moratórios de 2% (dois por cento) ao mês");
    expect(html).toContain("Correção monetária pelo IGP-M/FGV");
    expect(html).toContain("prazo de 20 (vinte) dias sem a purgação da mora");
    expect(html).toContain("reterão 8% (oito por cento)");
    expect(html).toContain("em até 45 (quarenta e cinco) dias");
    expect(html).toContain("multa diária de R$ 250,00 (duzentos e cinquenta reais)");
    // Sem sobra de placeholder nem número órfão.
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toMatch(/\bde\s*%/);
  });

  it.each([
    ["ccv_a_vista_v2.hbs", previewSampleDataAVista],
    ["ccv_financiamento_v2.hbs", previewSampleDataFinanciamento],
  ])("%s: sem data de assinatura, o fecho não sai quebrado", (file, sample) => {
    // Achado do E2E em staging. O fecho é `{{config.municipio_imovel}},
    // {{dataExtenso config.data_assinatura}}.` — com data vazia rendia
    // "São Paulo/SP, .". Sempre foi assim quando o cliente deixava a data em
    // branco no formulário, mas o campo SAIU do form (a data real da assinatura
    // é decidida depois, na aba Configurações): o que era eventual virou
    // sistemático — todo contrato novo nasceria com o fecho quebrado.
    const html = renderSemAssinatura(file, sample);
    expect(html).not.toMatch(/,\s*\.\s*<\/p>/);
    expect(html).toContain("São Paulo/SP.</p>");
  });

  it("com data de assinatura, o fecho volta a trazê-la por extenso", () => {
    const html = render("ccv_a_vista_v2.hbs", {
      ...previewSampleDataAVista,
      assinatura: { cidade: "Santos", uf: "SP", data: "2026-08-01" },
    });
    expect(html).toContain("Santos/SP, 1 de agosto de 2026.");
  });

  it("decimais no percentual saem por extenso corretamente", () => {
    // Guarda-trilho do `numeroExtenso`: 1,5% não pode virar "um por cento".
    const html = norm(
      render("ccv_a_vista_v2.hbs", previewSampleDataAVista, {
        ...DEFAULT_CONTRACT_SETTINGS,
        config: { ...DEFAULT_CONTRACT_SETTINGS.config, multa_penal_moratoria: 1.5 },
      })
    );
    expect(html).toMatch(/Multa moratória de 1,5% \(um.*\) sobre/);
    expect(html).not.toContain("Multa moratória de 1,5% (um por cento) sobre o valor da obrigação inadimplida;");
  });
});
