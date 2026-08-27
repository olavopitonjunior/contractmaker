import { describe, it, expect, vi } from "vitest";
import { mapExtractedToForm, type ExtractedDoc, type Assignment } from "../extracted-to-form";

/**
 * O ramo de vocabulário do formulário.
 *
 * Motivo de existir: medido em 188 anexos de produção, **43,9% de tudo que o
 * OCR lê é descartado** porque o nome da chave não bate com o do formulário —
 * o modelo devolve `telefone` e o form quer `mobile_phone`, devolve
 * `titular_cpf` e o form quer `cpf`. O dicionário entre os dois tem 14 entradas
 * fixas; o que não está nele some, mesmo estando certo.
 *
 * A extração guiada instrui o modelo com os nomes finais. Estes testes provam
 * que esse payload chega ao formulário sem tradução — e que o caminho antigo
 * continua intacto para os documentos já extraídos.
 */
function formFalso(iniciais: Record<string, unknown> = {}) {
  const valores: Record<string, unknown> = { ...iniciais };
  return {
    valores,
    form: {
      getValues: (p?: string) => (p ? valores[p] : valores),
      setValue: (p: string, v: unknown) => {
        valores[p] = v;
      },
      clearErrors: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const vendedor: Assignment = { kind: "vendedor", index: 0 };

describe("mapExtractedToForm — vocab: 'form'", () => {
  it("aplica as chaves direto, sem passar pelo dicionário", () => {
    const { valores, form } = formFalso();
    const doc: ExtractedDoc = {
      category: "rg",
      vocab: "form",
      fields: { nome: "Joao da Silva", cpf: "529.982.247-25", nome_mae: "Maria" },
    };

    const n = mapExtractedToForm(doc, vendedor, form);

    expect(valores["vendedores.0.nome"]).toBe("Joao da Silva");
    expect(valores["vendedores.0.nome_mae"]).toBe("Maria");
    // CPF passa pelo mesmo `coerce` do caminho normal (só dígitos).
    expect(valores["vendedores.0.cpf"]).toBe("52998224725");
    expect(n).toBeGreaterThanOrEqual(3);
  });

  /**
   * O caso que dá razão à mudança: `mobile_phone` não existe no dicionário
   * `FIELD_MAP_PERSON`. Pelo caminho antigo o dado seria lido e jogado fora.
   */
  it("recupera campo que o dicionário NÃO cobre", () => {
    const { valores, form } = formFalso();
    const doc: ExtractedDoc = {
      category: "comprovante_residencia",
      vocab: "form",
      fields: { mobile_phone: "11987654321", email: "a@b.com", profissao: "Engenheiro" },
    };

    mapExtractedToForm(doc, vendedor, form);

    expect(valores["vendedores.0.mobile_phone"]).toBe("11987654321");
    expect(valores["vendedores.0.email"]).toBe("a@b.com");
    expect(valores["vendedores.0.profissao"]).toBe("Engenheiro");
  });

  it("respeita skipIfDirty — não sobrescreve o que a pessoa digitou", () => {
    const { valores, form } = formFalso({ "vendedores.0.nome": "Nome Digitado" });
    const doc: ExtractedDoc = {
      category: "rg",
      vocab: "form",
      fields: { nome: "Nome Do Documento", rg: "123456" },
    };

    mapExtractedToForm(doc, vendedor, form, { skipIfDirty: true });

    expect(valores["vendedores.0.nome"]).toBe("Nome Digitado");
    expect(valores["vendedores.0.rg"]).toBe("123456");
  });

  it("sentinela de ausência não vira texto no formulário", () => {
    const { valores, form } = formFalso();
    const doc: ExtractedDoc = {
      category: "rg",
      vocab: "form",
      fields: { nome: "null", rg: "N/A", cpf: "   " },
    };

    mapExtractedToForm(doc, vendedor, form);

    expect(valores["vendedores.0.nome"]).toBeUndefined();
    expect(valores["vendedores.0.rg"]).toBeUndefined();
    expect(valores["vendedores.0.cpf"]).toBeUndefined();
  });
});

describe("mapExtractedToForm — o caminho antigo continua intacto", () => {
  /**
   * Sem `vocab`, é como os 188 documentos já extraídos estão gravados. Se este
   * teste quebrar, a mudança é retroativa — e não pode ser.
   */
  it("payload sem vocab continua traduzindo pelo dicionário", () => {
    const { valores, form } = formFalso();
    const doc: ExtractedDoc = {
      category: "rg",
      fields: { nome_completo: "Joao", cpf_numero: "52998224725", filiacao_mae: "Maria" },
    };

    mapExtractedToForm(doc, vendedor, form);

    expect(valores["vendedores.0.nome"]).toBe("Joao");
    expect(valores["vendedores.0.cpf"]).toBe("52998224725");
    expect(valores["vendedores.0.nome_mae"]).toBe("Maria");
  });

  it("vocab 'ocr' explícito se comporta como ausente", () => {
    const { valores, form } = formFalso();
    const doc: ExtractedDoc = {
      category: "rg",
      vocab: "ocr",
      fields: { nome_completo: "Joao" },
    };

    mapExtractedToForm(doc, vendedor, form);
    expect(valores["vendedores.0.nome"]).toBe("Joao");
  });

  /**
   * O ramo guiado não dá `return`: um payload misto — chaves do formulário mais
   * chaves de OCR que alimentam ramos colaterais — precisa aproveitar as duas.
   */
  it("payload misto aproveita os dois vocabulários", () => {
    const { valores, form } = formFalso();
    const doc: ExtractedDoc = {
      category: "rg",
      vocab: "form",
      fields: { nome: "Joao", filiacao_mae: "Maria" },
    };

    mapExtractedToForm(doc, vendedor, form);

    expect(valores["vendedores.0.nome"]).toBe("Joao");
    // veio pelo dicionário, mesmo com vocab: "form"
    expect(valores["vendedores.0.nome_mae"]).toBe("Maria");
  });
});
