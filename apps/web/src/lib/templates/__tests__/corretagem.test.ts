import { describe, it, expect } from "vitest";
import {
  corretagemQualificacao,
  corretagemDadosPagamento,
  corretoresDe,
  type RegistroCorretor,
} from "../corretagem";
import { auditTemplateText } from "../pii-gate";
import { isKnownToken, requiredTokens } from "../placeholder-catalog";

/**
 * Rebuild da RE/MAX Trio (2026-09-02): 14 dos 16 modelos ingeridos foram
 * BARRADOS na ativação porque a cláusula de corretagem trazia agência, conta e
 * CPF de um corretor real, herdados do contrato-fonte. Ativar assim imprimiria
 * o mesmo corretor em todo contrato gerado. Estas chaves são a saída.
 *
 * Os documentos abaixo são sintéticos (CPF 529.982.247-25 é o canônico de
 * teste brasileiro) e existem para exercitar o gate, não para representar
 * ninguém.
 */

const PF = {
  nome: "Ana Ribeiro",
  tipo_pessoa: "fisica",
  cpf: "52998224725",
  creci: "12.345-F",
};
const PJ = {
  razao_social: "Atrio Negócios Imobiliários Ltda",
  tipo_pessoa: "juridica",
  cnpj: "64524938000193",
  creci: "52275-J",
};
const PIX = {
  pix_chave: "52998224725",
  pix_tipo_chave: "CPF",
  titular_nome: "Ana Ribeiro",
  titular_doc: "52998224725",
};
const CONTA = {
  banco: "Itaú",
  agencia: "1234",
  conta: "68233198-6",
  tipo_conta: "corrente",
};

const locacao = (angariadores: unknown[]) => ({ comissao: { angariadores } });

describe("corretagem — qualificação", () => {
  it("PF sai com nome, CPF mascarado e CRECI", () => {
    expect(corretagemQualificacao(locacao([PF]))).toBe(
      "Ana Ribeiro, inscrito(a) no CPF/MF sob nº 529.982.247-25, CRECI nº 12.345-F"
    );
  });

  it("PJ sai com razão social e CNPJ mascarado", () => {
    expect(corretagemQualificacao(locacao([PJ]))).toBe(
      "Atrio Negócios Imobiliários Ltda, inscrita no CNPJ/MF sob nº 64.524.938/0001-93, CRECI nº 52275-J"
    );
  });

  it("vários corretores viram uma lista; quem não tem nome não entra", () => {
    const out = corretagemQualificacao(locacao([PF, { creci: "9" }, PJ]));
    expect(out).toBe(
      "Ana Ribeiro, inscrito(a) no CPF/MF sob nº 529.982.247-25, CRECI nº 12.345-F; " +
        "Atrio Negócios Imobiliários Ltda, inscrita no CNPJ/MF sob nº 64.524.938/0001-93, CRECI nº 52275-J"
    );
  });

  it("negócio sem corretor devolve vazio, não uma frase pela metade", () => {
    expect(corretagemQualificacao(locacao([]))).toBe("");
    expect(corretagemQualificacao({})).toBe("");
  });

  it("documento de tamanho inesperado sai como veio — mascarar por engano é pior", () => {
    expect(corretagemQualificacao(locacao([{ nome: "X", cpf: "123" }]))).toBe(
      "X, inscrito(a) no CPF/MF sob nº 123"
    );
  });

  it("lê também o vocabulário de venda (contrato importado passa pelo extrator de CCV)", () => {
    expect(corretoresDe({ comissao: { comissionados: [PF] } })).toHaveLength(1);
    expect(corretagemQualificacao({ comissao: { comissionados: [PF] } })).toContain("Ana Ribeiro");
  });
});

describe("corretagem — dados de repasse", () => {
  it("PIX do formulário vira prosa com tipo de chave e titular", () => {
    expect(corretagemDadosPagamento(locacao([{ ...PF, recebimento: PIX }]))).toBe(
      "na chave PIX (CPF): 52998224725, de titularidade de Ana Ribeiro (529.982.247-25)"
    );
  });

  it("conta completa vira prosa com banco, agência e tipo", () => {
    expect(corretagemDadosPagamento(locacao([{ ...PF, recebimento: CONTA }]))).toBe(
      "no Banco Itaú, Agência 1234, Conta corrente nº 68233198-6"
    );
  });

  it("conta INCOMPLETA não vira texto — comissão para lugar nenhum é pior que parágrafo vazio", () => {
    const semTipo = { banco: "Itaú", agencia: "1234", conta: "68233198-6" };
    expect(corretagemDadosPagamento(locacao([{ ...PF, recebimento: semTipo }]))).toBe("");
    // Controle: com o campo que falta, a MESMA entrada produz texto.
    expect(
      corretagemDadosPagamento(locacao([{ ...PF, recebimento: { ...semTipo, tipo_conta: "corrente" } }]))
    ).not.toBe("");
  });

  it("sem recebimento e sem cadastro devolve vazio", () => {
    expect(corretagemDadosPagamento(locacao([PF]))).toBe("");
  });

  it("com um corretor só não repete o nome; com dois, prefixa cada linha", () => {
    const um = corretagemDadosPagamento(locacao([{ ...PF, recebimento: PIX }]));
    expect(um.startsWith("na chave PIX")).toBe(true);

    const dois = corretagemDadosPagamento(
      locacao([
        { ...PF, recebimento: PIX },
        { ...PJ, recebimento: CONTA },
      ])
    );
    expect(dois.split("\n")).toHaveLength(2);
    expect(dois).toContain("Ana Ribeiro: na chave PIX");
    expect(dois).toContain("Atrio Negócios Imobiliários Ltda: no Banco Itaú");
  });
});

describe("corretagem — cadastro completa o que o formulário não trouxe", () => {
  const registro: RegistroCorretor[] = [
    { id: "rec_1", cpfCnpj: "529.982.247-25", recebimento: CONTA },
    { id: "rec_2", cpfCnpj: "64524938000193", recebimento: PIX },
  ];

  it("casa por splitRecipientId", () => {
    const out = corretagemDadosPagamento(
      locacao([{ ...PF, splitRecipientId: "rec_2" }]),
      registro
    );
    expect(out).toContain("na chave PIX");
  });

  it("sem id, casa por documento ignorando a máscara", () => {
    const out = corretagemDadosPagamento(locacao([PF]), registro);
    expect(out).toBe("no Banco Itaú, Agência 1234, Conta corrente nº 68233198-6");
  });

  it("o formulário vence o cadastro — é o que aquele negócio combinou", () => {
    const out = corretagemDadosPagamento(locacao([{ ...PF, recebimento: PIX }]), registro);
    expect(out).toContain("na chave PIX");
    expect(out).not.toContain("Banco Itaú");
  });

  it("documento curto não casa por documento (não vira loteria)", () => {
    expect(corretagemDadosPagamento(locacao([{ nome: "X", cpf: "123" }]), registro)).toBe("");
  });

  it("dois cadastros com o mesmo documento: vence o PRIMEIRO da lista (quem chama ordena)", () => {
    // O índice único de SplitRecipient só cobre `active=true`; um rascunho pode
    // dividir o CPF com o cadastro ativo. O módulo não sabe qual é qual — o
    // contrato é: o chamador entrega o ativo antes (contract-generation ordena
    // por active desc, createdAt asc) e o primeiro que casa é o que sai no Doc.
    const rascunhoDepois: RegistroCorretor[] = [
      { id: "ativo", cpfCnpj: "52998224725", recebimento: CONTA },
      { id: "rascunho", cpfCnpj: "52998224725", recebimento: PIX },
    ];
    expect(corretagemDadosPagamento(locacao([PF]), rascunhoDepois)).toContain("Banco Itaú");
    // Controle: invertendo a ordem, a resposta inverte — é a ordem que decide.
    expect(
      corretagemDadosPagamento(locacao([PF]), [...rascunhoDepois].reverse())
    ).toContain("na chave PIX");
  });

  it("corretor fora do cadastro não puxa o repasse de outro", () => {
    const out = corretagemDadosPagamento(
      locacao([{ nome: "Outro", cpf: "11144477735" }]),
      registro
    );
    expect(out).toBe("");
  });
});

describe("corretagem — é a saída do gate de PII, não uma violação dele", () => {
  const LITERAL = `4.1.1. A comissão será paga a Ana Ribeiro, CPF 529.982.247-25, CRECI 12.345-F,
mediante depósito no Banco Itaú, Agência 1234, Conta corrente nº 68233198-6.`;
  const COM_CHAVES = `4.1.1. A comissão será paga a {{corretagem_qualificacao}},
mediante depósito {{corretagem_dados_pagamento}}.`;

  it("o texto literal É bloqueado — foi o que barrou 14 dos 16 modelos da Trio", () => {
    const pii = auditTemplateText(LITERAL);
    expect(pii.blocked).toBe(true);
    expect(pii.kinds).toEqual(expect.arrayContaining(["cpf", "bank_agency", "bank_account"]));
  });

  it("o mesmo parágrafo com as chaves NÃO é bloqueado", () => {
    expect(auditTemplateText(COM_CHAVES).blocked).toBe(false);
  });
});

describe("corretagem — catálogo", () => {
  it("as duas chaves existem em toda locação e são opcionais", () => {
    for (const m of ["locacao", "locacao_comercial", "temporada"]) {
      expect(isKnownToken("corretagem_qualificacao", m)).toBe(true);
      expect(isKnownToken("corretagem_dados_pagamento", m)).toBe(true);
      // Obrigatória travaria todo modelo de imobiliária que não fala de comissão.
      expect(requiredTokens(m)).not.toContain("corretagem_qualificacao");
      expect(requiredTokens(m)).not.toContain("corretagem_dados_pagamento");
    }
  });

  it("não existem na venda — lá a comissão tem outro vocabulário (comissao_valor)", () => {
    expect(isKnownToken("corretagem_qualificacao", "a_vista")).toBe(false);
    expect(isKnownToken("corretagem_dados_pagamento", "financiamento")).toBe(false);
  });
});
