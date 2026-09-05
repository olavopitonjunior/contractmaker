import { describe, expect, it } from "vitest";
import {
  addDaysSP,
  buildCorretorPayload,
  buildImovelPayload,
  buildPessoaPayload,
  buildVendaPayload,
  calcularComissao,
  extractVendaSource,
  formDateToApi,
  splitEqual,
  toApiDay,
  validarVendaSource,
  VendaExportBlockedError,
  type VendaExportDefaults,
} from "../export/build-venda-payload";
import { flattenFormFields } from "../client";

/** Fixture no formato `compra_venda_v1` (PF vendedora, PJ compradora, 2 comissionados). */
const FORM = {
  vendedores: [
    {
      tipo_pessoa: "fisica",
      nome: "Maria da Silva",
      cpf: "123.456.789-09",
      rg: "12.345.678-9",
      sexo: "feminino",
      data_nascimento: "1980-03-15",
      nacionalidade: "Brasileira",
      estado_civil: "casada",
      profissao: "engenheira",
      email: "maria@example.com",
      mobile_phone: "(11) 99999-0000",
      endereco: "Rua das Flores",
      numero: "10",
      complemento: "ap 42",
      bairro: "Centro",
      cidade: "São Paulo",
      uf: "sp",
      cep: "01001-000",
      conjuge: { nome: "José", cpf: "111.111.111-11" },
    },
  ],
  compradores: [
    {
      tipo_pessoa: "juridica",
      razao_social: "Compradora Ltda",
      cnpj: "12.345.678/0001-95",
      email: "fin@compradora.com",
      endereco: "Av. Paulista",
      numero: "1000",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01310-100",
      representante: { nome: "Carlos", cpf: "222.222.222-22" },
    },
  ],
  imoveis: [
    {
      rua: "Rua TESTE API",
      numero: "1",
      complemento: "casa",
      bairro: "Centro",
      cidade: "Sao Paulo",
      uf: "SP",
      cep: "01001-000",
      matricula: "12345",
      cartorio: "1º RI",
      descricao: "Casa térrea com 3 dormitórios",
    },
  ],
  pagamento: { valor_total: 420000, parcelas: [] },
  comissao: {
    valor: 12600,
    percentual: 3,
    quem_paga: "vendedor",
    quando_paga: "assinatura",
    prazo_dias_apos_marco: 10,
    forma_pagamento_preferida: "boleto",
    comissionados: [
      { nome: "Marcelo Corretor", cpf: "333.333.333-33", creci: "12345-F", percentual: 60, papel: "intermediador" },
      { nome: "Imob Parceira", cnpj: "98.765.432/0001-10", tipo_pessoa: "juridica", percentual: 40, papel: "imobiliaria_principal" },
    ],
  },
};

const DEFAULTS: VendaExportDefaults = {
  contaBancariaId: 6,
  filialId: 0,
  tipoImovelPadrao: 1,
  tipoPagamentoComissao: 0,
  tipoRecebimentoComissao: 0,
  emitirNf: false,
  gerarDimob: false,
  vencimentoDias: 7,
  tetoValorCents: 500_000_000,
};

const DEAL = { id: "deal_abc", title: "Venda Rua TESTE API", value: 420000, contractSignedAt: "2026-09-03T15:00:00.000Z" };

const IDS = {
  imovelId: "2088",
  compradores: { 0: "3882" },
  comissionados: { 0: { idPessoa: "115", idFavorecido: "204" }, 1: { idPessoa: "116", idFavorecido: "300" } },
};

describe("datas e frações", () => {
  it("toApiDay usa o dia de São Paulo: 00:30Z de 04/09 ainda é 03/09 em SP", () => {
    expect(toApiDay(new Date("2026-09-04T00:30:00.000Z"))).toBe("09/03/2026");
    expect(toApiDay(new Date("2026-09-04T03:30:00.000Z"))).toBe("09/04/2026");
  });
  it("addDaysSP soma dias no calendário de SP sem cruzar meia-noite por fuso", () => {
    expect(toApiDay(addDaysSP(new Date("2026-09-04T00:30:00.000Z"), 10))).toBe("09/13/2026");
    expect(toApiDay(addDaysSP(new Date("2026-12-31T20:00:00.000Z"), 1))).toBe("01/01/2027");
  });
  it("formDateToApi aceita ISO e DD/MM/YYYY; rejeita o resto", () => {
    expect(formDateToApi("1980-03-15")).toBe("03/15/1980");
    expect(formDateToApi("12/05/1980")).toBe("05/12/1980");
    expect(formDateToApi("15/03/80")).toBeUndefined();
    expect(formDateToApi("1980-13-01")).toBeUndefined();
    expect(formDateToApi("")).toBeUndefined();
  });
  it("splitEqual fecha em 100.00 com o resto na primeira parte", () => {
    expect(splitEqual(1)).toEqual(["100.00"]);
    expect(splitEqual(2)).toEqual(["50.00", "50.00"]);
    expect(splitEqual(3)).toEqual(["33.34", "33.33", "33.33"]);
    expect(splitEqual(6)).toEqual(["16.70", "16.66", "16.66", "16.66", "16.66", "16.66"]);
    for (const n of [3, 6, 7, 11]) {
      const soma = splitEqual(n).reduce((a, s) => a + Math.round(Number(s) * 100), 0);
      expect(soma).toBe(10000);
    }
  });
});

describe("extractVendaSource", () => {
  it("normaliza partes PF/PJ, documentos, endereço e comissão", () => {
    const s = extractVendaSource(FORM);
    expect(s.vendedores[0]).toMatchObject({
      tipoPessoa: "fisica",
      nome: "Maria da Silva",
      documento: "12345678909",
      sexo: "f",
      celular: "11999990000",
      endereco: { uf: "SP", cep: "01001000", endereco: "Rua das Flores" },
    });
    expect(s.compradores[0]).toMatchObject({ tipoPessoa: "juridica", nome: "Compradora Ltda", documento: "12345678000195" });
    expect(s.imoveis[0]).toMatchObject({ rua: "Rua TESTE API", cep: "01001000", matricula: "12345" });
    expect(s.valorTotal).toBe(420000);
    expect(s.comissao).toMatchObject({ valor: 12600, percentual: 3, quemPaga: "vendedor", prazoDias: 10, formaPreferida: "boleto" });
    expect(s.comissionados.map((c) => [c.documento, c.papel])).toEqual([
      ["33333333333", "intermediador"],
      ["98765432000110", "imobiliaria_principal"],
    ]);
  });

  it("valores em string BR ('850.000,00', '6,5') passam pelos parsers canônicos", () => {
    const s = extractVendaSource({
      ...FORM,
      pagamento: { valor_total: "R$ 850.000,00" },
      comissao: { ...FORM.comissao, valor: "25.500,00", percentual: "6,5", comissionados: [{ nome: "A", valor: "1.500" }] },
    });
    expect(s.valorTotal).toBe(850000);
    expect(s.comissao.valor).toBe(25500);
    expect(s.comissao.percentual).toBe(6.5);
    expect(s.comissionados[0].valor).toBe(1500);
  });

  it("nunca lança em dataJson vazio/inválido e cai nos avisos", () => {
    const s = extractVendaSource(null);
    expect(s.compradores).toEqual([]);
    const { warnings } = validarVendaSource(s, { id: "d", title: "t" }, DEFAULTS);
    const codes = warnings.filter((w) => w.blocking).map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["sem_comprador", "sem_vendedor", "sem_imovel", "sem_valor", "sem_comissao", "sem_comissionado"]));
  });

  it("legado sem comissionados[]: a imobiliária vira o único comissionado", () => {
    const s = extractVendaSource({
      ...FORM,
      comissao: { valor: 100, quem_paga: "comprador", imobiliaria_nome: "Piton Imóveis", imobiliaria_cnpj: "11.222.333/0001-44" },
    });
    expect(s.comissionados).toEqual([
      expect.objectContaining({ nome: "Piton Imóveis", documento: "11222333000144", percentual: 100, papel: "imobiliaria_principal" }),
    ]);
  });
});

describe("calcularComissao", () => {
  it("usa o valor da comissão e divide pelos percentuais dos comissionados", () => {
    const c = calcularComissao(extractVendaSource(FORM));
    expect(c.total).toBe(12600);
    expect(c.percentualSobreVenda).toBe(3);
    expect(c.itens.map((i) => [i.valor, i.participacao])).toEqual([[7560, 60], [5040, 40]]);
  });

  it("sem valor: percentual × venda; sem percentuais por comissionado: divide igual", () => {
    const s = extractVendaSource({
      ...FORM,
      comissao: { percentual: 5, comissionados: [{ nome: "A" }, { nome: "B" }] },
    });
    const c = calcularComissao(s);
    expect(c.total).toBe(21000);
    expect(c.itens.map((i) => [i.valor, i.participacao])).toEqual([[10500, 50], [10500, 50]]);
  });
});

describe("buildPessoaPayload / buildCorretorPayload / buildImovelPayload", () => {
  it("pessoa PF: nome, documento só dígitos, sexo 2, data MM/DD/YYYY, endereço; cônjuge fica de fora", () => {
    const p = buildPessoaPayload(extractVendaSource(FORM).vendedores[0]);
    expect(p).toMatchObject({
      ST_NOME_PES: "Maria da Silva",
      ST_CNPJ_PES: "12345678909",
      ST_SEXO_PES: 2,
      DT_NASCIMENTO_PES: "03/15/1980",
      ST_CELULAR_PES: "11999990000",
      ST_CEP_PES: "01001000",
      ST_ESTADO_PES: "SP",
      FL_PROPRIETARIOBENEFICIARIO_PES: 1,
    });
    expect(JSON.stringify(p)).not.toContain("José");
    expect(JSON.stringify(p)).not.toContain("11111111111");
    expect(p.ST_OBSERVACAO_PES).toContain("casada");
  });

  it("data de nascimento em DD/MM/AAAA também vira MM/DD/YYYY; ilegível vira aviso e fica de fora", () => {
    const br = extractVendaSource({ ...FORM, vendedores: [{ ...FORM.vendedores[0], data_nascimento: "12/05/1980" }] });
    expect(buildPessoaPayload(br.vendedores[0]).DT_NASCIMENTO_PES).toBe("05/12/1980");
    const ruim = extractVendaSource({ ...FORM, vendedores: [{ ...FORM.vendedores[0], data_nascimento: "maio de 80" }] });
    expect(buildPessoaPayload(ruim.vendedores[0]).DT_NASCIMENTO_PES).toBeUndefined();
    const { warnings } = validarVendaSource(ruim, DEAL, DEFAULTS);
    expect(warnings.map((w) => w.code)).toContain("data_invalida");
  });

  it("corretor: flag de corretor e CRECI na observação", () => {
    const c = buildCorretorPayload(extractVendaSource(FORM).comissionados[0]);
    expect(c).toMatchObject({ ST_NOME_PES: "Marcelo Corretor", ST_CNPJ_PES: "33333333333", FL_CORRETOR_PES: 1 });
    expect(c.ST_OBSERVACAO_PES).toContain("12345-F");
  });

  it("imóvel: identificador cm:<dealId>, tipo padrão, proprietário principal -1; frações fecham em 100", () => {
    const s = extractVendaSource(FORM);
    const im = buildImovelPayload({
      imovel: s.imoveis[0],
      dealId: "deal_abc",
      proprietarios: [{ idPessoa: "3883" }, { idPessoa: "3884" }, { idPessoa: "3885" }],
      tipoImovel: 1,
      valorVenda: 420000,
    });
    expect(im).toMatchObject({ ST_TIPO_IMO: "1", ST_IDENTIFICADOR_IMO: "cm:deal_abc", ST_CEP_IMO: "01001000", VL_VENDA_IMO: "420000.00" });
    expect(im.PROPRIETARIOS_BENEFICIARIOS).toEqual([
      { ID_PESSOA_PES: "3883", FL_PROPRIETARIO_PRB: "-1", NM_FRACAO_PRB: "33.34" },
      { ID_PESSOA_PES: "3884", FL_PROPRIETARIO_PRB: "1", NM_FRACAO_PRB: "33.33" },
      { ID_PESSOA_PES: "3885", FL_PROPRIETARIO_PRB: "1", NM_FRACAO_PRB: "33.33" },
    ]);
  });
});

describe("buildVendaPayload", () => {
  it("monta o payload do assistente: datas MM/DD/YYYY no dia de SP, valores com ponto, VENDEDORPARCELA1 por comissionado", () => {
    const r = buildVendaPayload({ source: extractVendaSource(FORM), deal: DEAL, defaults: DEFAULTS, ids: IDS, now: new Date("2026-09-05T12:00:00Z") });
    const p = r.payload;
    expect(p.ID_IMOVEL_IMO).toBe("2088");
    expect(p.DT_VENDA_VEN).toBe("09/03/2026");
    expect(p.VL_TOTAL_VEN).toBe("420000.00");
    expect(p.TX_COMISSAO_VEN).toBe("3");
    expect(p.VL_COMISSAO_VEN).toBe("12600.00");
    expect(p.FL_TIPORECEBIMENTOCOMISSAO_VEN).toBe("0"); // quem_paga = vendedor
    expect(p.ID_CONTABANCO_CB).toBe("6");
    expect(p.VENDAS_COMPRADORES).toEqual([
      expect.objectContaining({ ID_PESSOA_PES: "3882", FL_COMPRADOR_PES: "1", NM_FRACAO_VEC: "100.00", FL_PRINCIPAL_VEC: "1" }),
    ]);
    expect(p.VENDEDORES).toEqual([
      expect.objectContaining({ ID_VENDEDOR_VEV: "115", ID_FAVORECIDO_FAV: "204", VL_COMISSAO_ANG: "60", FL_TIPO_ANG: "1", ID_PESSOA_PES: "" }),
      expect.objectContaining({ ID_VENDEDOR_VEV: "116", ID_FAVORECIDO_FAV: "300", VL_COMISSAO_ANG: "40", FL_TIPO_ANG: "6" }),
    ]);
    // vencimento = assinatura + prazo_dias_apos_marco (10)
    expect(r.datas.vencimento).toBe("09/13/2026");
    expect(p.VENDEDORPARCELA1).toEqual([
      expect.objectContaining({ ID_VENDEDOR_VEV: "115", VL_ITEM_VEI: "7560.00", DT_VENCIMENTO_VEI: "09/13/2026", ST_FANTASIA_FAV: "Marcelo Corretor" }),
      expect.objectContaining({ ID_VENDEDOR_VEV: "116", VL_ITEM_VEI: "5040.00" }),
    ]);
    expect(p.COMISSOES.map((c) => c.FL_DESPESA)).toEqual(["0", "0"]);
    expect(p.COMISSAO_PARCELAS).toEqual([
      expect.objectContaining({ DT_VENCIMENTO_RECB: "09/13/2026", VL_EMITIDO_RECB: "12600.00", VL_TOTAL_RECB: "12600.00", FL_STATUS_RECB: "0" }),
    ]);
    expect(p.ST_OBSERVACAO_VEN).toContain("deal_abc");
    expect(p.ST_OBSERVACAO_VEN).toContain("matrícula 12345");
    expect(r.warnings.some((w) => w.blocking)).toBe(false);
  });

  it("assinatura às 21h30 BRT (00:30Z do dia seguinte) mantém a data de SP", () => {
    const r = buildVendaPayload({ source: extractVendaSource(FORM), deal: { ...DEAL, contractSignedAt: "2026-09-04T00:30:00.000Z" }, defaults: DEFAULTS, ids: IDS });
    expect(r.payload.DT_VENDA_VEN).toBe("09/03/2026");
    expect(r.datas.vencimento).toBe("09/13/2026");
  });

  it("sem data de assinatura: usa hoje (SP) e avisa; string inválida idem", () => {
    const now = new Date("2026-09-05T02:00:00.000Z"); // 23:00 BRT de 04/09
    for (const contractSignedAt of [null, "não sei"]) {
      const r = buildVendaPayload({ source: extractVendaSource(FORM), deal: { ...DEAL, contractSignedAt }, defaults: DEFAULTS, ids: IDS, now });
      expect(r.payload.DT_VENDA_VEN).toBe("09/04/2026");
      expect(r.warnings.map((w) => w.code)).toContain("data_venda_hoje");
    }
  });

  it("achata para a notação de colchetes que a tela envia", () => {
    const r = buildVendaPayload({ source: extractVendaSource(FORM), deal: DEAL, defaults: DEFAULTS, ids: IDS });
    const flat = Object.fromEntries(flattenFormFields(r.payload as never));
    expect(flat["VENDEDORPARCELA1[0][ID_VENDEDOR_VEV]"]).toBe("115");
    expect(flat["VENDAS_COMPRADORES[0][ID_PESSOA_PES]"]).toBe("3882");
    expect(flat["COMISSOES[1][ID_ITEM_VEI]"]).toBe("");
    expect(flat["FL_NOTAFISCAL_VEN"]).toBe("0");
  });

  it("quem_paga = comprador → FL_TIPORECEBIMENTOCOMISSAO_VEN=1; sem prazo → vencimentoDias da org", () => {
    const form = { ...FORM, comissao: { ...FORM.comissao, quem_paga: "comprador", prazo_dias_apos_marco: undefined } };
    const r = buildVendaPayload({ source: extractVendaSource(form), deal: DEAL, defaults: DEFAULTS, ids: IDS });
    expect(r.payload.FL_TIPORECEBIMENTOCOMISSAO_VEN).toBe("1");
    expect(r.datas.vencimento).toBe("09/10/2026");
  });

  it("quem_paga = ambos (50/50) bloqueia em vez de cobrar tudo de um lado", () => {
    const form = { ...FORM, comissao: { ...FORM.comissao, quem_paga: "ambos" } };
    expect(() => buildVendaPayload({ source: extractVendaSource(form), deal: DEAL, defaults: DEFAULTS, ids: IDS })).toThrow(/ambas as partes/);
  });

  it("três compradores: frações 33.34/33.33/33.33", () => {
    const form = { ...FORM, compradores: [FORM.compradores[0], { ...FORM.compradores[0], razao_social: "B" }, { ...FORM.compradores[0], razao_social: "C" }] };
    const r = buildVendaPayload({ source: extractVendaSource(form), deal: DEAL, defaults: DEFAULTS, ids: { ...IDS, compradores: { 0: "1", 1: "2", 2: "3" } } });
    expect(r.payload.VENDAS_COMPRADORES.map((c) => c.NM_FRACAO_VEC)).toEqual(["33.34", "33.33", "33.33"]);
  });

  it("bloqueia sem conta bancária, acima do teto, sem id de comprador ou sem favorecido do comissionado", () => {
    const s = extractVendaSource(FORM);
    expect(() => buildVendaPayload({ source: s, deal: DEAL, defaults: { ...DEFAULTS, contaBancariaId: null }, ids: IDS })).toThrow(VendaExportBlockedError);
    expect(() => buildVendaPayload({ source: s, deal: DEAL, defaults: { ...DEFAULTS, tetoValorCents: 100 }, ids: IDS })).toThrow(/teto/);
    expect(() => buildVendaPayload({ source: s, deal: DEAL, defaults: DEFAULTS, ids: { ...IDS, compradores: {} } })).toThrow(/sem id/);
    expect(() =>
      buildVendaPayload({ source: s, deal: DEAL, defaults: DEFAULTS, ids: { ...IDS, comissionados: { ...IDS.comissionados, 1: { idPessoa: "116" } } } })
    ).toThrow(/sem favorecido/);
  });

  it("validarVendaSource lista avisos sem exigir ids (preview antes de criar qualquer coisa)", () => {
    const form = {
      ...FORM,
      imoveis: [...FORM.imoveis, { ...FORM.imoveis[0], rua: "Outra" }],
      compradores: [{ ...FORM.compradores[0], cnpj: "" }],
      vendedores: [FORM.vendedores[0], { ...FORM.vendedores[0], nome: "Irmão", cpf: "444.444.444-44" }],
    };
    const { warnings } = validarVendaSource(extractVendaSource(form), DEAL, DEFAULTS);
    expect(warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["imoveis_extras", "documento_ausente", "tipo_imovel_padrao", "fracao_assumida"]));
    expect(warnings.every((w) => !w.blocking)).toBe(true);
  });
});
