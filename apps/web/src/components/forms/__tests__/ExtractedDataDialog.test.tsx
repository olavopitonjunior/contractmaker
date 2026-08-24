import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExtractedDataDialog } from "../ExtractedDataDialog";
import { ocrFieldLabel } from "@/lib/forms/ocr-field-labels";

/**
 * O dialog de revisão da extração.
 *
 * O que ele resolve: `extractedData` já vinha inteiro no payload do GET, mas o
 * card renderizava só 6 campos com rótulo cru (`k.replace(/_/g," ")`) e jogava
 * o resto fora. E "aplicou 0 campos" era indistinguível de "extração ruim".
 */
function abrir(props: Partial<React.ComponentProps<typeof ExtractedDataDialog>> = {}) {
  return render(
    <ExtractedDataDialog
      open
      onOpenChange={() => {}}
      filename="rg-joao.pdf"
      category="rg"
      fields={{ nome_completo: "Joao da Silva", cpf_numero: "52998224725" }}
      confidence={0.93}
      {...props}
    />
  );
}

describe("ExtractedDataDialog", () => {
  it("mostra TODOS os campos, não os 6 do card", () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) fields[`campo_${i}`] = `valor ${i}`;
    abrir({ fields });
    for (let i = 0; i < 12; i++) {
      expect(screen.getByText(`valor ${i}`)).toBeTruthy();
    }
  });

  it("usa rótulo humano em vez da chave crua do OCR", () => {
    abrir();
    expect(screen.getByText("Nome completo")).toBeTruthy();
    expect(screen.getByText("CPF")).toBeTruthy();
    expect(screen.queryByText("cpf_numero")).toBeNull();
  });

  it("mostra a confiança e a contagem de campos", () => {
    abrir();
    expect(screen.getByText("93% de confiança")).toBeTruthy();
    expect(screen.getByText("2 campo(s) extraído(s)")).toBeTruthy();
  });

  /**
   * CPF com dígito verificador errado é o único problema que NÃO é descartado
   * pela coerção: entra no formulário parecendo bom e só falha na certidão ou
   * na assinatura. Por isso tem bloco próprio, em destaque.
   */
  it("destaca CPF com dígito verificador errado", () => {
    abrir({ fields: { nome_completo: "Joao", cpf_numero: "12345678900" } });
    expect(screen.getByText(/Confira estes campos contra o documento/i)).toBeTruthy();
    // Aparece duas vezes de propósito: no bloco de destaque (que o corretor lê
    // primeiro) e ao lado do próprio campo na lista (onde ele confere o valor).
    expect(screen.getAllByText(/dígito verificador/i)).toHaveLength(2);
  });

  it("não inventa alerta quando o CPF é válido", () => {
    abrir();
    expect(screen.queryByText(/Confira estes campos contra o documento/i)).toBeNull();
  });

  it("marca campo que será descartado, em vez de fingir que foi aproveitado", () => {
    abrir({ fields: { nome_completo: "Joao", data_nascimento: "31/02/1980" } });
    expect(screen.getByText(/formato inaproveitável/i)).toBeTruthy();
  });

  it("sem preview de escrita, a seção não aparece", () => {
    abrir({ writePreview: null });
    expect(screen.queryByText(/Será preenchido no formulário/i)).toBeNull();
  });

  it("com preview, lista os paths com rótulo humano", () => {
    abrir({
      writePreview: [
        { path: "vendedores.0.nome", value: "Joao da Silva", jaPreenchido: false },
        { path: "vendedores.0.cpf", value: "52998224725", jaPreenchido: false },
      ],
    });
    expect(screen.getByText(/Será preenchido no formulário/i)).toBeTruthy();
    expect(screen.getByText("Vendedor — Nome")).toBeTruthy();
  });

  /**
   * O caso que a UI de hoje não distingue: "Aplicar" preencheria zero campos.
   * Sem esta mensagem, o corretor clica, vê "0 campos preenchidos" e não sabe
   * se o documento é ruim ou se o destino está errado.
   */
  it("preview vazio explica que nada seria preenchido", () => {
    abrir({ writePreview: [] });
    expect(screen.getByText(/Nada seria preenchido/i)).toBeTruthy();
  });

  it("documento sem campo extraído não quebra", () => {
    abrir({ fields: {} });
    expect(screen.getByText(/Nenhum campo foi extraído/i)).toBeTruthy();
  });

  /**
   * Tachado significa DESCARTADO. `cpf_invalido` é gravado no formulário —
   * tachá-lo diria ao revisor o contrário do que o dialog existe para dizer.
   */
  it("CPF inválido NÃO é tachado — ele será gravado, e é o que precisa de olho", () => {
    // O Radix renderiza o dialog num PORTAL, fora do container do render.
    abrir({ fields: { nome_completo: "Joao", cpf_numero: "12345678900" } });
    expect(document.querySelectorAll(".line-through").length).toBe(0);
    expect(
      document.querySelectorAll(".text-destructive").length
    ).toBeGreaterThan(0);
  });

  it("campo realmente descartado continua tachado", () => {
    abrir({ fields: { nome_completo: "Joao", data_nascimento: "31/02/1980" } });
    expect(document.querySelectorAll(".line-through").length).toBeGreaterThan(0);
  });

  /**
   * Ficha-resumo não passa pelo mapper — é aplicada por caminho próprio e
   * preenche o formulário inteiro. Dizer "nada seria preenchido" para ela
   * mandaria o operador reatribuir um documento que já funciona.
   */
  it("ficha-resumo explica o preenchimento automático em vez de dizer que nada acontece", () => {
    abrir({
      category: "ficha_resumo",
      fields: { partes: [{ nome: "Joao", cpf: "52998224725" }] },
      writePreview: [],
    });
    expect(screen.getByText(/aplicada automaticamente/i)).toBeTruthy();
    expect(screen.queryByText(/Nada seria preenchido/i)).toBeNull();
  });

  /**
   * `computeDocWrites` roda com skipIfDirty:false, mas o "Aplicar" real usa
   * true. Sem esta marcação, o preview prometeria escrever exatamente onde a
   * diferença importa: o campo que o operador digitou à mão.
   */
  it("marca o que NÃO será sobrescrito por já estar preenchido", () => {
    abrir({
      writePreview: [
        { path: "vendedores.0.cpf", value: "52998224725", jaPreenchido: true },
      ],
    });
    expect(screen.getByText(/não será sobrescrito/i)).toBeTruthy();
  });
});

describe("ocrFieldLabel", () => {
  it("traduz as chaves do COMBINED_PROMPT", () => {
    expect(ocrFieldLabel("matricula_numero")).toBe("Matrícula");
    expect(ocrFieldLabel("filiacao_mae")).toBe("Nome da mãe");
    expect(ocrFieldLabel("onus_existentes")).toBe("Ônus e gravames");
  });

  /**
   * Chave nova no prompt não pode virar tela quebrada — o fallback é o mesmo
   * comportamento que o card tinha inline, agora explícito.
   */
  it("chave desconhecida cai num rótulo legível", () => {
    expect(ocrFieldLabel("campo_novo_do_prompt")).toBe("Campo novo do prompt");
  });
});
