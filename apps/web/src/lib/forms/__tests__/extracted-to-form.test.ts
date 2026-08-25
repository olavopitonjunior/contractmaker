import { describe, expect, it, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import {
  coerce,
  collectExtractionIssues,
  mapExtractedToForm,
  pickSpouseFromCertidao,
  resolveBasePath,
  suggestAssignment,
  type Assignment,
  type ExtractedDoc,
} from "../extracted-to-form";

/**
 * Núcleo do autofill de VENDA. Cobre o que a revisão de 2026-07-31 acrescentou
 * (sub-slots cônjuge/procurador/representante, certidão de casamento e
 * procuração como fontes de campo) sem quebrar os ramos históricos.
 *
 * Form stub: mapa plano path → valor, igual ao usado em
 * extracted-to-form-locacao.test.ts.
 */
function makeFormStub(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const setValue = vi.fn((path: string, value: unknown) => {
    store.set(path, value);
  });
  const getValues = vi.fn((path?: string) => {
    if (path === undefined) {
      const out: Record<string, unknown> = {};
      store.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    }
    return store.get(path);
  });
  // O autofill limpa o erro do campo que acabou de preencher; sem este
  // mock o stub mentiria sobre a interface que o codigo usa.
  const clearErrors = vi.fn();
  return {
    form: { setValue, getValues, clearErrors } as unknown as UseFormReturn<Record<string, unknown>>,
    store,
    clearErrors,
  };
}

const RG: ExtractedDoc = {
  category: "rg",
  fields: {
    nome_completo: "Ana Cônjuge",
    cpf_numero: "111.222.333-44",
    rg_numero: "MG-1234567",
    filiacao_mae: "Mãe da Ana",
    data_nascimento: "1980-01-02",
    naturalidade: "Belo Horizonte",
    sexo: "F",
    bairro: "Centro",
    cidade: "Campinas",
    uf: "SP",
    cep: "13010-000",
    endereco_completo: "Rua das Acácias, 45",
  },
};

const PROCURACAO: ExtractedDoc = {
  category: "procuracao",
  fields: {
    outorgante_nome: "João Vendedor",
    outorgante_cpf: "555.666.777-88",
    outorgado_nome: "Carlos Procurador",
    outorgado_cpf: "999.888.777-66",
  },
};

const CERTIDAO: ExtractedDoc = {
  category: "certidao_casamento",
  fields: {
    conjuge1_nome: "João Vendedor",
    conjuge1_cpf: "555.666.777-88",
    conjuge2_nome: "Ana Cônjuge",
    conjuge2_cpf: "111.222.333-44",
    regime_bens: "Comunhão parcial de bens",
  },
};

describe("resolveBasePath", () => {
  it("titulares, sub-slots e imóvel", () => {
    expect(resolveBasePath({ kind: "vendedor", index: 1 })).toBe("vendedores.1");
    expect(resolveBasePath({ kind: "conjuge_comprador", index: 0 })).toBe(
      "compradores.0.conjuge"
    );
    expect(resolveBasePath({ kind: "representante_vendedor", index: 2 })).toBe(
      "vendedores.2.representante"
    );
    expect(resolveBasePath({ kind: "procurador_vendedor", index: 0 })).toBe(
      "vendedores.0.procurador"
    );
    expect(resolveBasePath({ kind: "procurador_comprador", index: 3 })).toBe(
      "compradores.3.procurador"
    );
    expect(resolveBasePath({ kind: "imovel", index: 0 })).toBe("imoveis.0");
    expect(resolveBasePath({ kind: "outro", index: 0 })).toBeNull();
  });
});

describe("mapExtractedToForm — cônjuge (kind conjuge_*)", () => {
  it("RG do cônjuge preenche o subobjeto e liga o estado civil do pai (D2)", () => {
    const { form, store } = makeFormStub({ "vendedores.0.nome": "João Vendedor" });
    const filled = mapExtractedToForm(RG, { kind: "conjuge_vendedor", index: 0 }, form);
    expect(filled).toBeGreaterThan(0);
    expect(store.get("vendedores.0.conjuge.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.conjuge.cpf")).toBe("11122233344");
    expect(store.get("vendedores.0.conjuge.rg")).toBe("MG-1234567");
    // D2 — sem isto a UI do cônjuge nem renderiza.
    expect(store.get("vendedores.0.estado_civil")).toBe("Casado(a)");
    // Endereço fica com o titular (endereco_igual_ao_titular default true).
    expect(store.get("vendedores.0.conjuge.cidade")).toBeUndefined();
    expect(store.get("vendedores.0.conjuge.endereco")).toBeUndefined();
  });

  it("D2 NÃO sobrescreve estado civil já preenchido", () => {
    const { form, store } = makeFormStub({
      "vendedores.0.estado_civil": "União Estável",
    });
    mapExtractedToForm(RG, { kind: "conjuge_vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.estado_civil")).toBe("União Estável");
  });

  it("cônjuge com endereço próprio (flag false) recebe o endereço", () => {
    const { form, store } = makeFormStub({
      "compradores.0.conjuge.endereco_igual_ao_titular": false,
    });
    mapExtractedToForm(RG, { kind: "conjuge_comprador", index: 0 }, form);
    expect(store.get("compradores.0.conjuge.cidade")).toBe("Campinas");
    expect(store.get("compradores.0.conjuge.endereco")).toBe("Rua das Acácias");
    expect(store.get("compradores.0.conjuge.numero")).toBe("45");
  });
});

describe("mapExtractedToForm — allowlist dos sub-slots (chaves órfãs)", () => {
  it("representante não recebe endereço (o schema da PJ não tem)", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(RG, { kind: "representante_vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.representante.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.representante.nome_mae")).toBe("Mãe da Ana");
    for (const orphan of ["endereco", "numero", "bairro", "cidade", "uf", "cep"]) {
      expect(store.get(`vendedores.0.representante.${orphan}`)).toBeUndefined();
    }
  });

  it("procurador recebe endereço mas não nome_mae/data_nascimento/naturalidade", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(RG, { kind: "procurador_vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.procurador.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.procurador.cpf")).toBe("11122233344");
    expect(store.get("vendedores.0.procurador.rg")).toBe("MG-1234567");
    expect(store.get("vendedores.0.procurador.sexo")).toBe("F");
    expect(store.get("vendedores.0.procurador.endereco")).toBe("Rua das Acácias");
    expect(store.get("vendedores.0.procurador.numero")).toBe("45");
    expect(store.get("vendedores.0.procurador.cidade")).toBe("Campinas");
    expect(store.get("vendedores.0.procurador.uf")).toBe("SP");
    for (const orphan of ["nome_mae", "data_nascimento", "naturalidade", "cep", "bairro"]) {
      expect(store.get(`vendedores.0.procurador.${orphan}`)).toBeUndefined();
    }
    // D3 — a atribuição é intenção explícita de que existe procurador.
    expect(store.get("vendedores.0.tem_procurador")).toBe(true);
  });
});

describe("mapExtractedToForm — procuração", () => {
  it("no slot do procurador aplica o OUTORGADO + liga tem_procurador (D3)", () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToForm(
      PROCURACAO,
      { kind: "procurador_vendedor", index: 0 },
      form
    );
    // nome + cpf + tem_procurador
    expect(filled).toBe(3);
    expect(store.get("vendedores.0.procurador.nome")).toBe("Carlos Procurador");
    expect(store.get("vendedores.0.procurador.cpf")).toBe("99988877766");
    expect(store.get("vendedores.0.tem_procurador")).toBe(true);
  });

  it("tem_procurador já true não conta em filled", () => {
    const { form } = makeFormStub({ "vendedores.0.tem_procurador": true });
    const filled = mapExtractedToForm(
      PROCURACAO,
      { kind: "procurador_vendedor", index: 0 },
      form
    );
    expect(filled).toBe(2);
  });

  it("no slot do representante aplica o OUTORGADO (D4)", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(PROCURACAO, { kind: "representante_comprador", index: 1 }, form);
    expect(store.get("compradores.1.representante.nome")).toBe("Carlos Procurador");
    expect(store.get("compradores.1.representante.cpf")).toBe("99988877766");
    // Não liga tem_procurador de um representante.
    expect(store.get("compradores.1.tem_procurador")).toBeUndefined();
  });

  it("no slot do titular aplica o OUTORGANTE (D5) — antes era no-op", () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToForm(PROCURACAO, { kind: "vendedor", index: 0 }, form);
    expect(filled).toBe(2);
    expect(store.get("vendedores.0.nome")).toBe("João Vendedor");
    expect(store.get("vendedores.0.cpf")).toBe("55566677788");
  });

  it("skipIfDirty protege o titular já digitado", () => {
    const { form, store } = makeFormStub({ "vendedores.0.nome": "Nome Digitado" });
    mapExtractedToForm(PROCURACAO, { kind: "vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.nome")).toBe("Nome Digitado");
    expect(store.get("vendedores.0.cpf")).toBe("55566677788");
  });
});

describe("pickSpouseFromCertidao (D1)", () => {
  const fields = CERTIDAO.fields;

  it("titular = conjuge1 (por CPF) → cônjuge é conjuge2", () => {
    expect(pickSpouseFromCertidao(fields, { cpf: "555.666.777-88" })).toEqual({
      nome: "Ana Cônjuge",
      cpf: "11122233344",
    });
  });

  it("titular = conjuge2 (por CPF) → cônjuge é conjuge1", () => {
    expect(pickSpouseFromCertidao(fields, { cpf: "11122233344" })).toEqual({
      nome: "João Vendedor",
      cpf: "55566677788",
    });
  });

  it("sem CPF, desempata por nome normalizado (acentos/caixa)", () => {
    expect(pickSpouseFromCertidao(fields, { nome: "ana conjuge" })).toEqual({
      nome: "João Vendedor",
      cpf: "55566677788",
    });
  });

  it("sem match cai em conjuge2 (convenção do ramo histórico)", () => {
    expect(pickSpouseFromCertidao(fields, null)).toEqual({
      nome: "Ana Cônjuge",
      cpf: "11122233344",
    });
    expect(pickSpouseFromCertidao(fields, { nome: "Outra Pessoa" })).toEqual({
      nome: "Ana Cônjuge",
      cpf: "11122233344",
    });
  });
});

describe("mapExtractedToForm — certidão de casamento", () => {
  it("atribuída ao cônjuge: escolhe o nubente certo e liga o estado civil do pai", () => {
    const { form, store } = makeFormStub({
      "vendedores.0.nome": "João Vendedor",
      "vendedores.0.cpf": "55566677788",
    });
    mapExtractedToForm(CERTIDAO, { kind: "conjuge_vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.conjuge.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.conjuge.cpf")).toBe("11122233344");
    // Regime informado → prefere o inferido ao "Casado(a)" genérico.
    expect(store.get("vendedores.0.estado_civil")).toBe("Casado(a)");
  });

  it("quando o titular é o conjuge2, o cônjuge vira o conjuge1", () => {
    const { form, store } = makeFormStub({
      "compradores.0.cpf": "11122233344",
    });
    mapExtractedToForm(CERTIDAO, { kind: "conjuge_comprador", index: 0 }, form);
    expect(store.get("compradores.0.conjuge.nome")).toBe("João Vendedor");
    expect(store.get("compradores.0.conjuge.cpf")).toBe("55566677788");
  });

  it("regressão: atribuída ao TITULAR segue preenchendo o cônjuge embutido", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(CERTIDAO, { kind: "vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.estado_civil")).toBe("Casado(a)");
    expect(store.get("vendedores.0.conjuge.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.conjuge.cpf")).toBe("11122233344");
  });
});

// ============================================================================
// suggestAssignment — os matches de sub-slot não tinham cobertura nenhuma.
// ============================================================================

describe("suggestAssignment — sub-slots", () => {
  const snapshot = {
    vendedores: [
      {
        tipo_pessoa: "fisica",
        nome: "João Vendedor",
        cpf: "55566677788",
        conjuge: { nome: "Ana Cônjuge", cpf: "11122233344" },
        procurador: { nome: "Carlos Procurador", cpf: "99988877766" },
      },
    ],
    compradores: [
      {
        tipo_pessoa: "juridica",
        razao_social: "Imob LTDA",
        cnpj: "11222333000181",
        representante: { nome: "Rita Representante", cpf: "12345678909" },
      },
    ],
  };

  it("CPF do cônjuge cadastrado → conjuge_vendedor", () => {
    expect(
      suggestAssignment("rg", { cpf_numero: "111.222.333-44" }, snapshot)
    ).toEqual({ kind: "conjuge_vendedor", index: 0 });
  });

  it("nome do representante da PJ → representante_comprador", () => {
    expect(
      suggestAssignment("cnh", { nome_completo: "rita representante" }, snapshot)
    ).toEqual({ kind: "representante_comprador", index: 0 });
  });

  it("CPF do procurador cadastrado → procurador_vendedor", () => {
    expect(
      suggestAssignment("rg", { cpf_numero: "99988877766" }, snapshot)
    ).toEqual({ kind: "procurador_vendedor", index: 0 });
  });

  it("procuração casa o OUTORGANTE contra o titular e sugere o procurador dele", () => {
    expect(suggestAssignment("procuracao", PROCURACAO.fields, snapshot)).toEqual({
      kind: "procurador_vendedor",
      index: 0,
    });
  });

  it("procuração de outorgante desconhecido casa pelo OUTORGADO já cadastrado", () => {
    expect(
      suggestAssignment(
        "procuracao",
        { outorgante_nome: "Ninguém", outorgado_cpf: "99988877766" },
        snapshot
      )
    ).toEqual({ kind: "procurador_vendedor", index: 0 });
  });

  it("procuração sem nenhum match cai em outro", () => {
    expect(
      suggestAssignment(
        "procuracao",
        { outorgante_nome: "Ninguém", outorgado_nome: "Outro Alguém" },
        snapshot
      )
    ).toEqual({ kind: "outro", index: 0 });
  });

  it("titular ainda tem prioridade sobre os sub-slots", () => {
    expect(
      suggestAssignment("rg", { cpf_numero: "55566677788" }, snapshot)
    ).toEqual({ kind: "vendedor", index: 0 });
  });
});

/**
 * Achado na smoke em staging: o campo preenchido pela IA continuava com borda
 * vermelha e "Campo obrigatório", enquanto o MESMO campo preenchido à mão
 * ficava limpo — `setValue` não mexe em erro, digitação sim. A extração
 * parecia não ter funcionado justamente onde funcionou.
 */
describe("autofill limpa o erro do campo que preencheu", () => {
  const MATRICULA: ExtractedDoc = {
    category: "matricula",
    fields: { matricula_numero: "98.765", cartorio: "3º RI de São Paulo/SP" },
  };
  const alvo: Assignment = { kind: "imovel", index: 0 };

  it("chama clearErrors para cada campo aplicado", () => {
    const { form, clearErrors } = makeFormStub();
    const filled = mapExtractedToForm(MATRICULA, alvo, form);
    expect(filled).toBeGreaterThan(0);
    const limpos = clearErrors.mock.calls.map((c) => c[0]);
    expect(limpos).toContain("imoveis.0.matricula");
    expect(limpos).toContain("imoveis.0.cartorio");
    expect(clearErrors).toHaveBeenCalledTimes(filled);
  });

  it("campo pulado por skipIfDirty NAO tem o erro limpo", () => {
    // O valor do usuário prevaleceu, então o estado de erro daquele campo
    // continua sendo assunto do que ele digitou — não da extração.
    const { form, clearErrors } = makeFormStub({
      "imoveis.0.matricula": "ja digitado",
    });
    mapExtractedToForm(MATRICULA, alvo, form, { skipIfDirty: true });
    expect(clearErrors.mock.calls.map((c) => c[0])).not.toContain(
      "imoveis.0.matricula"
    );
  });
});

/**
 * Normalização do que o OCR devolve, antes de virar valor de formulário.
 *
 * Os casos abaixo tinham o mesmo sintoma para o corretor — "o campo ficou
 * vazio" ou "veio lixo" — e causas diferentes, nenhuma visível na tela.
 */
describe("coerce — data em DD/MM/AAAA", () => {
  const rg = (dataNascimento: string): ExtractedDoc => ({
    category: "rg",
    fields: { nome_completo: "Joao da Silva", data_nascimento: dataNascimento },
  });
  const alvo: Assignment = { kind: "vendedor", index: 0 };

  /**
   * O bug: `<input type="date">` só aceita ISO. Uma data em DD/MM/AAAA era
   * gravada por setValue e o browser descartava sem erro — o campo ficava
   * vazio e a extração parecia ter falhado. É o formato impresso no RG, então
   * o modelo devolve assim com frequência.
   */
  it("converte para ISO em vez de deixar o browser descartar", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(rg("12/05/1980"), alvo, form);
    expect(store.get("vendedores.0.data_nascimento")).toBe("1980-05-12");
  });

  it("mantém ISO que já veio correto", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(rg("1980-05-12"), alvo, form);
    expect(store.get("vendedores.0.data_nascimento")).toBe("1980-05-12");
  });

  it("descarta data impossível em vez de gravar lixo", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(rg("31/02/1980"), alvo, form);
    expect(store.has("vendedores.0.data_nascimento")).toBe(false);
    // O resto do documento continua sendo aproveitado.
    expect(store.get("vendedores.0.nome")).toBe("Joao da Silva");
  });
});

describe("coerce — sentinelas de ausência", () => {
  const alvo: Assignment = { kind: "vendedor", index: 0 };

  /**
   * Sem `nullable` no responseSchema, o Gemma devolvia a string "null" para
   * todo campo ilegível. Ela era gravada como TEXTO no formulário.
   */
  it.each(["null", "N/A", "não informado", "[ilegível]", "-"])(
    "%s não vira texto no formulário",
    (sentinela) => {
      const { form, store } = makeFormStub();
      mapExtractedToForm(
        {
          category: "rg",
          fields: { nome_completo: "Joao da Silva", naturalidade: sentinela },
        },
        alvo,
        form
      );
      expect(store.has("vendedores.0.naturalidade")).toBe(false);
      expect(store.get("vendedores.0.nome")).toBe("Joao da Silva");
    }
  );

  it("não confunde conteúdo legítimo que contém a palavra", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(
      { category: "rg", fields: { naturalidade: "Nulo de Minas" } },
      alvo,
      form
    );
    expect(store.get("vendedores.0.naturalidade")).toBe("Nulo de Minas");
  });
});

describe("collectExtractionIssues", () => {
  const HOJE = new Date(2026, 7, 24);

  /**
   * O mais perigoso dos três: 11 dígitos, formato plausível, é gravado no
   * formulário — e só quebra na certidão, na ClickSign ou no DIMOB, longe
   * de quem poderia ter conferido contra o documento.
   */
  it("acusa CPF com dígito verificador errado", () => {
    const issues = collectExtractionIssues({ cpf_numero: "12345678900" }, HOJE);
    expect(issues).toEqual([
      { ocrKey: "cpf_numero", raw: "12345678900", reason: "cpf_invalido" },
    ]);
  });

  it("CPF válido não vira ruído", () => {
    // 529.982.247-25 — CPF de teste com dígitos verificadores corretos.
    expect(collectExtractionIssues({ cpf_numero: "52998224725" }, HOJE)).toEqual([]);
  });

  it("distingue CPF truncado (formato) de CPF que não fecha (cpf_invalido)", () => {
    const issues = collectExtractionIssues({ cpf_numero: "1234567" }, HOJE);
    expect(issues[0].reason).toBe("formato");
  });

  it("acusa sentinela como ausente, não como erro de formato", () => {
    const issues = collectExtractionIssues({ cpf_numero: "null" }, HOJE);
    expect(issues[0].reason).toBe("ausente");
  });

  it("acusa data que o formulário vai descartar", () => {
    const issues = collectExtractionIssues({ data_nascimento: "31/02/1980" }, HOJE);
    expect(issues[0]).toMatchObject({ ocrKey: "data_nascimento", reason: "formato" });
  });

  it("data em DD/MM/AAAA não é problema — é normalizada", () => {
    expect(collectExtractionIssues({ data_nascimento: "12/05/1980" }, HOJE)).toEqual([]);
  });

  it("campo vazio não gera ruído (não veio ≠ veio errado)", () => {
    expect(
      collectExtractionIssues({ cpf_numero: null, data_nascimento: "" }, HOJE)
    ).toEqual([]);
  });

  it("fields ausente devolve lista vazia", () => {
    expect(collectExtractionIssues(null)).toEqual([]);
  });

  /**
   * `data_validade` é `required` em CNH_FIELDS e, numa CNH válida, é FUTURA
   * por definição. Validá-la com a regra de nascimento (que rejeita futuro)
   * marcaria toda CNH boa como problema — e uma lista de revisão que acusa o
   * caso normal ensina o revisor a ignorá-la.
   */
  it("CNH válida não gera problema nenhum, apesar da validade futura", () => {
    const cnh = {
      nome_completo: "Joao da Silva",
      cpf_numero: "52998224725",
      data_nascimento: "12/05/1980",
      data_emissao: "01/03/2021",
      data_validade: "01/03/2031",
    };
    expect(collectExtractionIssues(cnh, HOJE)).toEqual([]);
  });

  it("mas data de nascimento no futuro continua sendo problema", () => {
    const issues = collectExtractionIssues({ data_nascimento: "01/03/2031" }, HOJE);
    expect(issues[0]).toMatchObject({ ocrKey: "data_nascimento", reason: "formato" });
  });

  it("validade com calendário impossível ainda é acusada", () => {
    const issues = collectExtractionIssues({ data_validade: "31/02/2031" }, HOJE);
    expect(issues[0]).toMatchObject({ ocrKey: "data_validade", reason: "formato" });
  });

  /**
   * O schema pede string, mas prompt é pedido, não garantia — e um CPF que
   * voltou como número não é um CPF ruim.
   */
  it("CPF que veio como número não é falso positivo", () => {
    expect(collectExtractionIssues({ cpf_numero: 52998224725 }, HOJE)).toEqual([]);
  });

  /**
   * A ficha-resumo guarda CPF e data DENTRO de `partes[]`. Sem descer no array,
   * justamente o documento que carrega mais CPFs — e que preenche o formulário
   * inteiro — seria o único a nunca acusar problema nenhum.
   */
  it("desce em partes[] da ficha-resumo e identifica de quem é o CPF", () => {
    const issues = collectExtractionIssues(
      {
        partes: [
          { nome: "Joao", cpf: "52998224725" },
          { nome: "Maria", cpf: "12345678900" },
        ],
      },
      HOJE
    );
    expect(issues).toEqual([
      { ocrKey: "partes[1].cpf", raw: "12345678900", reason: "cpf_invalido" },
    ]);
  });

  it("desce em imoveis[] também", () => {
    const issues = collectExtractionIssues(
      { imoveis: [{ cep: "123" }] },
      HOJE
    );
    expect(issues[0]).toMatchObject({ ocrKey: "imoveis[0].cep", reason: "formato" });
  });

  it("ficha sem problema nenhum devolve lista vazia", () => {
    expect(
      collectExtractionIssues(
        { partes: [{ nome: "Joao", cpf: "52998224725", data_nascimento: "12/05/1980" }] },
        HOJE
      )
    ).toEqual([]);
  });

  it("array ausente ou item não-objeto não quebra", () => {
    expect(collectExtractionIssues({ partes: "nao e array" }, HOJE)).toEqual([]);
    expect(collectExtractionIssues({ partes: [null, 42] }, HOJE)).toEqual([]);
  });
});

describe("coerce — CEP com dígitos a mais", () => {
  const alvo: Assignment = { kind: "vendedor", index: 0 };

  /**
   * `maskCEP` faz `slice(0, 8)`. Sem gate antes, "Rua X, 123 - CEP 01310100"
   * virava "12301-310": oito dígitos, formato válido, CEP errado — e seguia
   * para DIMOB e Asaas como se fosse bom. Errado que parece certo é pior que
   * ausente, porque ninguém vai conferir.
   */
  it("descarta em vez de truncar num CEP plausível e errado", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(
      { category: "rg", fields: { cep: "Rua X, 123 - CEP 01310100" } },
      alvo,
      form
    );
    expect(store.has("vendedores.0.cep")).toBe(false);
  });

  it("CEP limpo é mascarado como o input faria", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm({ category: "rg", fields: { cep: "01310100" } }, alvo, form);
    expect(store.get("vendedores.0.cep")).toBe("01310-100");
  });

  it("coerce e collectExtractionIssues concordam sobre o mesmo valor", () => {
    const ruim = "Rua X, 123 - CEP 01310100";
    expect(coerce("cep", ruim)).toBeUndefined();
    expect(collectExtractionIssues({ cep: ruim })[0]?.reason).toBe("formato");
  });
});

describe("caminhos que não passam por applyField", () => {
  /**
   * Nome de cônjuge (certidão e averbação de RG/CNH) escreve direto no path.
   * Sem filtro explícito, um "null" do modelo virava o NOME do cônjuge — e
   * ainda contava como campo preenchido.
   */
  it("sentinela não vira nome do cônjuge (averbação de RG)", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(
      {
        category: "rg",
        fields: { nome_completo: "Joao da Silva", conjuge_nome: "null" },
      },
      { kind: "vendedor", index: 0 },
      form
    );
    expect(store.has("vendedores.0.conjuge.nome")).toBe(false);
  });

  it("cônjuge de verdade continua sendo aplicado", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(
      {
        category: "rg",
        fields: { nome_completo: "Joao da Silva", conjuge_nome: "Maria Souza" },
      },
      { kind: "vendedor", index: 0 },
      form
    );
    expect(store.get("vendedores.0.conjuge.nome")).toBe("Maria Souza");
  });
});
