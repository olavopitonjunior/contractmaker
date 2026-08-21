import { describe, it, expect } from "vitest";
import { buildConsolidatedFormSummary } from "@/lib/forms/form-summary";

/**
 * A linha "Matrícula atualizada" no resumo do formulário — o PDF que a equipe
 * lê antes da diligência. É a informação que decide se dá pra seguir: sem
 * matrícula atualizada e negativa de ônus, a escritura não se lavra.
 *
 * Coberto por teste porque o resumo só é gerado no finalize, e validá-lo pelo
 * navegador exigiria finalizar um formulário a cada verificação.
 */
describe("resumo do formulário — situação da matrícula", () => {
  const comImovel = (imovel: Record<string, unknown>) =>
    buildConsolidatedFormSummary({
      imoveis: [{ rua: "Rua A", numero: "10", ...imovel }],
    });

  const linhas = (imovel: Record<string, unknown>) => {
    const secao = comImovel(imovel).find((s) => s.title.startsWith("Imóvel"));
    return secao?.rows ?? [];
  };
  const valorDe = (imovel: Record<string, unknown>, label: string) =>
    linhas(imovel).find((r) => r.label === label)?.value;

  it("'solicitar' vira 'A ser solicitada'", () => {
    expect(valorDe({ matricula_situacao: "solicitar" }, "Matrícula atualizada")).toBe(
      "A ser solicitada"
    );
  });

  it("'possui' com anexo nomeia o arquivo — sem precisar resolver o id", () => {
    expect(
      valorDe(
        {
          matricula_situacao: "possui",
          matricula_attachment_id: "att1",
          matricula_attachment_filename: "matricula-98765.pdf",
        },
        "Matrícula atualizada"
      )
    ).toBe("Anexada (matricula-98765.pdf)");
  });

  it("'possui' sem filename ainda diz que está anexada", () => {
    expect(valorDe({ matricula_situacao: "possui" }, "Matrícula atualizada")).toBe(
      "Anexada ao formulário"
    );
  });

  it("formulário legado NÃO ganha a linha — não inventa pendência retroativa", () => {
    const labels = linhas({ matricula: "123" }).map((r) => r.label);
    expect(labels).not.toContain("Matrícula atualizada");
    // E o resto do bloco registral continua saindo normalmente.
    expect(labels).toContain("Matrícula");
  });

  it("a linha nova não desloca nem apaga as antigas", () => {
    const labels = linhas({
      matricula: "98.765",
      cartorio: "3º RI",
      matricula_situacao: "solicitar",
    }).map((r) => r.label);
    expect(labels.indexOf("Matrícula atualizada")).toBe(
      labels.indexOf("Cartório") + 1
    );
  });
});
