import { describe, it, expect } from "vitest";
import {
  buildHiddenPaths,
  buildProposalDataJson,
  buildProposalSigners,
  buildProposalTitle,
  emptyProposalForm,
  formatAmountInput,
  parseProposalForm,
  type ProposalFormValues,
} from "../form-data";
import { deriveTemplateFacts } from "@/lib/contracts/template-category";

function locacaoForm(over: Partial<ProposalFormValues> = {}): ProposalFormValues {
  return {
    ...emptyProposalForm("locacao", "locacao_residencial_v1"),
    proponentes: [
      {
        tipoPessoa: "fisica",
        nome: "Maria Souza",
        documento: "111.222.333-44",
        email: "maria@ex.com",
        phone: "11999990000",
        canal: "whatsapp",
      },
    ],
    imovelEndereco: "Rua das Flores, 100",
    valor: "3.500,00",
    ...over,
  };
}

describe("buildProposalDataJson", () => {
  it("venda: compradores/vendedores + pagamento.valor_total", () => {
    const v: ProposalFormValues = {
      ...emptyProposalForm("venda", "compra_venda_v1"),
      proponentes: [
        {
          tipoPessoa: "fisica",
          nome: "João",
          documento: "12345678909",
          email: "j@ex.com",
          phone: "",
          canal: "email",
        },
      ],
      vendedores: [
        {
          tipoPessoa: "juridica",
          nome: "Incorporadora XPTO",
          documento: "11.222.333/0001-44",
          email: "xpto@ex.com",
          phone: "",
          canal: "email",
        },
      ],
      imovelEndereco: "Av. Central, 1",
      valor: "850.000",
    };
    const d = buildProposalDataJson(v) as Record<string, never>;
    expect(d.compradores).toEqual([
      {
        tipo_pessoa: "fisica",
        nome: "João",
        email: "j@ex.com",
        telefone: "",
        cpf: "12345678909",
      },
    ]);
    // PJ escreve razao_social E nome — o resumo da listagem lê `nome`.
    expect(d.vendedores).toEqual([
      {
        tipo_pessoa: "juridica",
        nome: "Incorporadora XPTO",
        email: "xpto@ex.com",
        telefone: "",
        razao_social: "Incorporadora XPTO",
        cnpj: "11222333000144",
      },
    ]);
    expect(d.pagamento).toEqual({ valor_total: 850000 });
    expect(d.imoveis).toEqual([{ endereco: "Av. Central, 1" }]);
    // Venda não tem garantia.
    expect(d.garantia).toBeUndefined();
  });

  it("locação escreve os DOIS shapes de valor e de imóvel", () => {
    const d = buildProposalDataJson(locacaoForm()) as Record<string, never>;
    // listagem/convert
    expect(d.locacao).toEqual({ valor_aluguel: 3500 });
    expect(d.imoveis).toEqual([{ endereco: "Rua das Flores, 100" }]);
    // templates de proposta de locação
    expect(d.aluguel).toEqual({ valor: 3500 });
    expect(d.imovel).toEqual({ rua: "Rua das Flores, 100" });
  });

  it("parseMoneyBR, não replace: '1000.00' é mil (não cem mil)", () => {
    const d = buildProposalDataJson(locacaoForm({ valor: "1000.00" })) as Record<string, never>;
    expect(d.locacao).toEqual({ valor_aluguel: 1000 });
  });

  it("garantia sem fiador não escreve bloco de fiador morto", () => {
    const v = locacaoForm();
    v.garantia = {
      tipo: "caucao",
      provider: "",
      caucaoMeses: "3",
      fiador: { ...v.garantia.fiador, nome: "Fiador Fantasma" },
    };
    const d = buildProposalDataJson(v) as Record<string, never>;
    expect(d.garantia).toEqual({ tipo: "caucao", caucao_meses: 3 });
  });

  it("snapshot do iList entra inteiro quando o endereço não foi editado", () => {
    const snap = { ilistId: "L1", endereco: "Rua X, 9", listingCode: "AP01", preco: 4200 };
    const v = locacaoForm({ imovelEndereco: "Rua X, 9", ilistSnapshot: snap });
    expect((buildProposalDataJson(v) as Record<string, never>).imoveis).toEqual([snap]);
    // Endereço editado à mão descarta o snapshot (deixou de ser aquele imóvel).
    const v2 = locacaoForm({ imovelEndereco: "Rua Y, 2", ilistSnapshot: snap });
    expect((buildProposalDataJson(v2) as Record<string, never>).imoveis).toEqual([
      { endereco: "Rua Y, 2" },
    ]);
  });
});

describe("GAP da Fase 1.2 — os fatos de seleção de variante saem do form", () => {
  it("locatário PF + fiador PJ produz os fatos que o matchCriteria compara", () => {
    const v = locacaoForm();
    v.garantia = {
      tipo: "fiador",
      provider: "",
      caucaoMeses: "",
      fiador: {
        tipoPessoa: "juridica",
        nome: "Garantidora SA",
        documento: "11222333000144",
        email: "",
        phone: "",
        canal: "email",
      },
    };
    expect(deriveTemplateFacts(buildProposalDataJson(v))).toEqual({
      garantia: "fiador",
      fiadorPessoa: "pj",
      pessoa: "pf",
    });
  });

  it("locatário PJ é detectado pelo tipo_pessoa (não só pelo CNPJ)", () => {
    const v = locacaoForm();
    v.proponentes = [{ ...v.proponentes[0], tipoPessoa: "juridica", documento: "" }];
    v.garantia = { ...v.garantia, tipo: "sem_garantia" };
    expect(deriveTemplateFacts(buildProposalDataJson(v))).toEqual({
      garantia: "sem_garantia",
      fiadorPessoa: null,
      pessoa: "pj",
    });
  });
});

describe("buildProposalSigners", () => {
  it("proponente no grupo 1, vendedor e testemunha no 2", () => {
    const v = locacaoForm({
      vendedores: [
        {
          tipoPessoa: "fisica",
          nome: "Ana",
          documento: "",
          email: "ana@ex.com",
          phone: "",
          canal: "email",
        },
      ],
      witnesses: [
        { name: "Testa", email: "testa@ex.com", documentation: "99988877766", phone: "" },
      ],
    });
    const s = buildProposalSigners(v);
    expect(s.map((x) => [x.role, x.signingGroup])).toEqual([
      ["proponente", 1],
      ["vendedor", 2],
      ["testemunha", 2],
    ]);
    expect(s[0].notifyChannel).toBe("whatsapp");
    expect(s[0].cpf).toBe("11122233344");
  });

  it("testemunha que colide com uma parte é descartada (evita P2002)", () => {
    const v = locacaoForm({
      witnesses: [
        { name: "Maria Souza", email: "maria@ex.com", documentation: "11122233344", phone: "" },
      ],
    });
    expect(buildProposalSigners(v)).toHaveLength(1);
  });

  it("testemunha sem e-mail é descartada (o canal dela é e-mail)", () => {
    const v = locacaoForm({
      witnesses: [{ name: "Sem Contato", email: "", documentation: "", phone: "" }],
    });
    expect(buildProposalSigners(v)).toHaveLength(1);
  });

  it("parte sem nome não vira signatário nem dado", () => {
    const v = locacaoForm();
    v.proponentes = [...v.proponentes, { ...v.proponentes[0], nome: "   ", email: "x@y.z" }];
    expect(buildProposalSigners(v)).toHaveLength(1);
    expect((buildProposalDataJson(v) as Record<string, never[]>).locatarios).toHaveLength(1);
  });
});

describe("título e hiddenPaths", () => {
  it("título = 1º proponente — imóvel", () => {
    expect(buildProposalTitle(locacaoForm())).toBe("Maria Souza — Rua das Flores, 100");
  });

  it("esconder comissão exige comissão incluída E proprietário assinando", () => {
    const semVendedor = locacaoForm({ comissao: true, esconderComissao: true });
    expect(buildHiddenPaths(semVendedor)).toEqual([]);
    const comVendedor = locacaoForm({
      comissao: true,
      esconderComissao: true,
      vendedores: [
        {
          tipoPessoa: "fisica",
          nome: "Dono",
          documento: "",
          email: "",
          phone: "",
          canal: "email",
        },
      ],
    });
    expect(buildHiddenPaths(comVendedor)).toEqual(["comissao"]);
    expect(buildHiddenPaths({ ...comVendedor, comissao: false })).toEqual([]);
  });
});

describe("parseProposalForm — prefill da edição", () => {
  it("é o inverso de buildProposalDataJson (roundtrip sem perder campo)", () => {
    const original = locacaoForm({
      vendedores: [
        {
          tipoPessoa: "juridica",
          nome: "Imob LTDA",
          documento: "11222333000144",
          email: "imob@ex.com",
          phone: "",
          canal: "email",
        },
      ],
      comissao: true,
      esconderComissao: true,
    });
    original.garantia = {
      tipo: "fiador",
      provider: "",
      caucaoMeses: "",
      fiador: {
        tipoPessoa: "fisica",
        nome: "Fiador Silva",
        documento: "55566677788",
        email: "",
        phone: "",
        canal: "email",
      },
    };

    const dataJson = buildProposalDataJson(original);
    const signers = buildProposalSigners(original);
    const back = parseProposalForm({
      kind: "locacao",
      schemaType: "locacao_residencial_v1",
      dataJson,
      comissaoIncluida: original.comissao,
      hiddenPaths: buildHiddenPaths(original),
      signers: signers.map((s) => ({
        role: s.role,
        name: s.name,
        email: s.email,
        cpf: s.cpf,
        phone: s.phone,
        notifyChannel: s.notifyChannel,
      })),
    });

    expect(back.proponentes[0]).toMatchObject({
      tipoPessoa: "fisica",
      nome: "Maria Souza",
      documento: "11122233344",
      canal: "whatsapp",
    });
    expect(back.vendedores[0]).toMatchObject({
      tipoPessoa: "juridica",
      nome: "Imob LTDA",
      documento: "11222333000144",
    });
    expect(back.imovelEndereco).toBe("Rua das Flores, 100");
    expect(back.valor).toBe("3.500,00");
    expect(back.garantia.tipo).toBe("fiador");
    expect(back.garantia.fiador.nome).toBe("Fiador Silva");
    expect(back.comissao).toBe(true);
    expect(back.esconderComissao).toBe(true);
    // Salvar de novo tem que produzir exatamente o mesmo dataJson.
    expect(buildProposalDataJson({ ...back, witnesses: original.witnesses })).toEqual(dataJson);
  });

  it("reidrata as TESTEMUNHAS dos signers (senão o PATCH as apagaria)", () => {
    const back = parseProposalForm({
      kind: "venda",
      schemaType: "compra_venda_v1",
      dataJson: { compradores: [{ nome: "X" }] },
      signers: [
        { role: "proponente", name: "X", notifyChannel: "email" },
        {
          role: "testemunha",
          name: "Testa",
          email: "t@ex.com",
          cpf: "99988877766",
          phone: null,
          notifyChannel: "email",
        },
      ],
    });
    expect(back.witnesses).toEqual([
      { name: "Testa", email: "t@ex.com", documentation: "99988877766", phone: "" },
    ]);
  });

  it("proposta ANTIGA (partes só com nome) abre sem quebrar", () => {
    const back = parseProposalForm({
      kind: "locacao",
      schemaType: "locacao_residencial_v1",
      dataJson: { locatarios: [{ nome: "Fulano" }], locacao: { valor_aluguel: 2000 } },
    });
    expect(back.proponentes[0]).toMatchObject({ tipoPessoa: "fisica", nome: "Fulano" });
    expect(back.valor).toBe("2.000,00");
    expect(back.garantia.tipo).toBe("caucao");
  });

  it("dataJson vazio devolve uma parte em branco (form usável)", () => {
    const back = parseProposalForm({
      kind: "venda",
      schemaType: "compra_venda_v1",
      dataJson: {},
    });
    expect(back.proponentes).toHaveLength(1);
    expect(back.proponentes[0].nome).toBe("");
    expect(back.valor).toBe("");
  });
});

describe("formatAmountInput", () => {
  it("agrupa determinísticamente (sem ICU — React #418)", () => {
    expect(formatAmountInput(1500)).toBe("1.500,00");
    expect(formatAmountInput(850000.5)).toBe("850.000,50");
    expect(formatAmountInput(0)).toBe("");
    expect(formatAmountInput(null)).toBe("");
  });
});
