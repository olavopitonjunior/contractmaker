import { describe, it, expect } from "vitest";
import { renderQualityChecks, quickChecks } from "../quickChecks";

describe("renderQualityChecks (A0.2)", () => {
  it("flags empty signing place/date line (', .') as error", () => {
    const html = `<p>E por estarem assim justos e contratados, firmam o presente instrumento.</p><p>, .</p><div class="assinaturas"></div>`;
    const findings = renderQualityChecks(html);
    const f = findings.find((x) => x.message.includes("local e a data de assinatura"));
    expect(f).toBeTruthy();
    expect(f!.severity).toBe("error");
    expect(f!.category).toBe("render");
  });

  it("flags leftover Handlebars variables as error", () => {
    const html = `<p>Cidade: {{config.municipio_imovel}}, data {{dataExtenso config.data_assinatura}}.</p>`;
    const findings = renderQualityChecks(html);
    const f = findings.find((x) => x.message.includes("variáveis de template"));
    expect(f).toBeTruthy();
    expect(f!.severity).toBe("error");
  });

  it("flags R$ 0,00 (zero reais) in price/commission", () => {
    const html = `<p><strong>11.1.</strong> A comissão é de R$ 0,00 (zero reais), correspondente a 0,00%.</p>`;
    const findings = renderQualityChecks(html);
    expect(findings.some((x) => x.selectedText === "R$ 0,00 (zero reais)")).toBe(true);
  });

  it("detects subclause numbering gap 2.1.1 -> 2.1.2 -> 2.1.4", () => {
    const html = `<p><strong>2.1.1.</strong> a</p><p><strong>2.1.2.</strong> b</p><p><strong>2.1.4.</strong> c</p>`;
    const findings = renderQualityChecks(html);
    const f = findings.find((x) => x.message.includes("Numeração de subcláusulas"));
    expect(f).toBeTruthy();
    expect(f!.message).toContain("2.1.3");
  });

  it("detects a long duplicated block (>=20 words appearing twice)", () => {
    const para =
      "R$ 50.000,00 serão pagos através da entrega do veículo marca modelo HYUNDAI HB20S cor preta combustível álcool gasolina ano de fabricação dois mil e quatorze placa e renavam e chassi aceito pelo vendedor como parte do pagamento ajustado neste instrumento de forma irrevogável e irretratável.";
    const html = `<p><strong>c)</strong> ${para}</p><p><strong>2.1.4.</strong> ${para}</p>`;
    const findings = renderQualityChecks(html);
    expect(findings.some((x) => x.message.includes("bloco de texto longo duplicado"))).toBe(true);
  });

  it("flags empty CPF/Nacionalidade labels but ignores testemunha underscores", () => {
    const filled = `<p>Nome: Fulano<br>CPF: <br>Nacionalidade: </p>`;
    const f1 = renderQualityChecks(filled);
    expect(f1.some((x) => x.selectedText === "CPF:")).toBe(true);

    const witness = `<p>Nome: ___________________________<br>CPF: ___________________________</p>`;
    const f2 = renderQualityChecks(witness);
    expect(f2.some((x) => x.category === "render" && x.selectedText.startsWith("CPF"))).toBe(false);
  });

  it("returns nothing for a clean contract fragment", () => {
    const html = `<p>São Paulo, 19 de maio de 2026.</p><p><strong>2.1.1.</strong> a</p><p><strong>2.1.2.</strong> b</p>`;
    const findings = renderQualityChecks(html);
    expect(findings.length).toBe(0);
  });

  it("works on plain text (getDocPlainText) input too", () => {
    const text = `E por estarem assim justos e contratados, firmam o presente instrumento.\n\n, .\n\nPROMITENTES VENDEDORES`;
    const findings = renderQualityChecks(text);
    expect(findings.some((x) => x.severity === "error" && x.message.includes("local e a data"))).toBe(true);
  });

  it("quickChecks integrates render findings", () => {
    const html = `<p>, .</p>`;
    const findings = quickChecks({}, html);
    expect(findings.some((x) => x.category === "render")).toBe(true);
  });
});
