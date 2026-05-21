import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Render real (setup.ts mocka renderContratoHTML globalmente).
vi.unmock("@/lib/render/handlebars");

import { enrichContractData } from "@/lib/services/contract-generation";
import { renderContratoHTML } from "@/lib/render/handlebars";
import {
  previewSampleDataAVista,
  previewSampleDataFinanciamento,
} from "@/lib/templates/preview-sample-data";

/**
 * A0.1 — Parity test form↔template (anti-recorrência, QA deal 20486).
 *
 * Renderiza cada template v2 contra a sample data COMPLETA (mesmo shape do form,
 * cobrindo todas as condicionais) passando por `enrichContractData`, e exige
 * que NÃO sobre nenhum `{{...}}` no HTML final. Se alguém adicionar um
 * `{{config.novaVar}}` ao template sem fonte no form nem no enrich (foi
 * exatamente o caso de `config.municipio_imovel`/`config.data_assinatura`),
 * a variável vaza como `{{...}}` literal e este teste FALHA no CI — antes de
 * subir pra produção.
 */
function templatePath(filename: string): string {
  // vitest roda com cwd = apps/web → repo/templates fica em ../../templates
  // (mesma resolução de scripts/sync-templates.ts).
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

function leftoverMustaches(html: string): string[] {
  return Array.from(new Set(html.match(/\{\{[^{}]+\}\}/g) ?? []));
}

describe("template parity (A0.1)", () => {
  it("CCV À Vista: nenhuma variável de template fica sem fonte", () => {
    const tpl = readFileSync(templatePath("ccv_a_vista_v2.hbs"), "utf-8");
    const enriched = enrichContractData(
      JSON.parse(JSON.stringify(previewSampleDataAVista))
    );
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);
    const leftover = leftoverMustaches(html);
    expect(leftover, `Variáveis sem fonte no template à vista: ${leftover.join(", ")}`).toEqual([]);
  });

  it("CCV Financiamento: nenhuma variável de template fica sem fonte", () => {
    const tpl = readFileSync(templatePath("ccv_financiamento_v2.hbs"), "utf-8");
    const enriched = enrichContractData(
      JSON.parse(JSON.stringify(previewSampleDataFinanciamento))
    );
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);
    const leftover = leftoverMustaches(html);
    expect(leftover, `Variáveis sem fonte no template financiamento: ${leftover.join(", ")}`).toEqual([]);
  });

  it("À Vista: fecho com local E data preenchidos (regressão F1)", () => {
    const tpl = readFileSync(templatePath("ccv_a_vista_v2.hbs"), "utf-8");
    const enriched = enrichContractData(
      JSON.parse(JSON.stringify(previewSampleDataAVista))
    );
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);
    // não deve haver fecho vazio "<p>, .</p>"
    expect(/<p>\s*,\s*\.?\s*<\/p>/.test(html)).toBe(false);
    expect(html).toMatch(/São Paulo\/SP,\s*19 de maio de 2026\./);
  });
});
