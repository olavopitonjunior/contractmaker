import { describe, it, expect } from "vitest";
import { buildConsolidatedFormSummary } from "@/lib/forms/form-summary";
import { enrichContractData } from "@/lib/services/contract-generation";

/**
 * O gerador de PDF (`form-summary-pdf.ts::prepareDataForSummary`) passa o
 * dataJson pelo enrich antes de montar as seções. Estes casos provam POR QUE:
 * os buckets de pagamento não existem no dataJson cru — são derivados de
 * `parcelas[].tipo`.
 */
const findSection = (
  secs: ReturnType<typeof buildConsolidatedFormSummary>,
  title: string
) => secs.find((s) => s.title.startsWith(title));

const formDataJson = {
  vendedores: [{ tipo_pessoa: "fisica", nome: "João", cpf: "11122233344" }],
  modalidade: "financiamento",
  pagamento: {
    // Valores que o Zod default-a em 0 — no dataJson cru é isso que existe,
    // mesmo num negócio com pagamento todo preenchido.
    valor_total: 800000,
    sinal_arras: 0,
    recursos_proprios: 0,
    fgts: 0,
    alienacao_fiduciaria: 0,
    cessao_consorcio: 0,
    outras_formas: 0,
    // `tipo` segue o vocabulário de TIPO_TO_BUCKET (contract-generation.ts):
    // "financiamento" cai no bucket `alienacao_fiduciaria`.
    parcelas: [
      { tipo: "sinal_arras", valor: 80000 },
      { tipo: "financiamento", valor: 720000 },
    ],
  },
  imoveis: [{ cidade: "São Paulo", uf: "SP" }],
  assinatura: { cidade: "São Paulo", uf: "SP", data: "2026-06-09" },
};

describe("resumo do formulário sobre dados enriquecidos", () => {
  it("dataJson CRU esconde o pagamento (regressão: seção sumia do PDF)", () => {
    const secs = buildConsolidatedFormSummary(structuredClone(formDataJson));
    const pag = findSection(secs, "Pagamento")!;
    // O total aparece, mas a composição (sinal/financiamento) não — é
    // exatamente a informação que o corretor precisa e que faltava.
    expect(pag.rows.find((r) => r.label === "Sinal / arras")).toBeUndefined();
    expect(pag.rows.find((r) => r.label === "Financiamento")).toBeUndefined();
  });

  it("após o enrich, os buckets saem das parcelas", () => {
    const secs = buildConsolidatedFormSummary(
      enrichContractData(structuredClone(formDataJson))
    );
    const pag = findSection(secs, "Pagamento")!;
    expect(pag.rows).toContainEqual({ label: "Valor total", value: "R$ 800.000,00" });
    expect(pag.rows).toContainEqual({ label: "Sinal / arras", value: "R$ 80.000,00" });
    expect(pag.rows).toContainEqual({ label: "Financiamento", value: "R$ 720.000,00" });
    // Bucket sem parcela correspondente continua fora (0 = não se aplica).
    expect(pag.rows.find((r) => r.label === "FGTS")).toBeUndefined();
  });

  it("enrich não muta o dataJson de origem (config é nested)", () => {
    // `enrichContractData` faz spread raso e MUTA `config` — por isso o gerador
    // passa structuredClone. Se um dia isso mudar, este teste avisa.
    const original = structuredClone(formDataJson);
    const snapshot = JSON.stringify(original);
    enrichContractData(structuredClone(original));
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
