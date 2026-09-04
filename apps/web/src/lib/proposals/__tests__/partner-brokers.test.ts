import { describe, it, expect } from "vitest";
import {
  MAX_PARTNER_BROKERS,
  PARTNER_BROKERS_KEY,
  PARTNER_BROKER_DEFAULT_PAPEL,
  emptyPartnerBroker,
  partnerBrokersFromData,
  partnerBrokersToRows,
  readPartnerBrokerRows,
  validatePartnerBrokers,
  validatePartnerBrokersInData,
  type PartnerBrokerInput,
} from "../partner-brokers";
import { buildProposalDataJson, emptyProposalForm, parseProposalForm } from "../form-data";

const parceiro = (over: Partial<PartnerBrokerInput> = {}): PartnerBrokerInput => ({
  ...emptyPartnerBroker(),
  nome: "Carla Parceira",
  creci: "123456-F/SP",
  phone: "(11) 99999-0001",
  email: "Carla@Parceira.com",
  ...over,
});

const proponente = {
  tipoPessoa: "fisica" as const,
  nome: "João",
  documento: "",
  email: "",
  phone: "",
  canal: "email",
};

describe("partner-brokers — chave própria, fora da comissão", () => {
  it("a chave é de topo e NÃO é comissao.comissionados/angariadores", () => {
    // Decisão de code review (04/09/2026): aquelas listas são a distribuição da
    // comissão e vão parar no contrato (cláusula de intermediadora do CCV) e no
    // wizard de split. Parceiro só recebe e-mail.
    expect(PARTNER_BROKERS_KEY).toBe("corretores_parceiros");
  });

  it("toRows: normaliza telefone, baixa o e-mail, papel default, descarta sem nome", () => {
    const rows = partnerBrokersToRows([parceiro(), parceiro({ nome: "   " })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      nome: "Carla Parceira",
      creci: "123456-F/SP",
      mobile_phone: "+5511999990001",
      email: "carla@parceira.com",
      papel: PARTNER_BROKER_DEFAULT_PAPEL,
    });
  });

  it("toRows: mantém splitRecipientId quando veio do registry", () => {
    const rows = partnerBrokersToRows([parceiro({ splitRecipientId: "sr-1" })]);
    expect(rows[0].splitRecipientId).toBe("sr-1");
  });

  it("read/fromData: lê a lista, ignora lixo e linhas sem nome; ignora comissao.*", () => {
    const data = {
      corretores_parceiros: [
        { nome: "A", creci: "1", mobile_phone: "+5511", email: "a@x", splitRecipientId: "s" },
        null,
        "x",
        { email: "sem-nome@x" },
      ],
      comissao: { comissionados: [{ nome: "Comissionado de verdade" }] },
    };
    expect(readPartnerBrokerRows(data).map((r) => r.nome)).toEqual(["A"]);
    expect(partnerBrokersFromData(data)).toEqual([
      { splitRecipientId: "s", nome: "A", creci: "1", phone: "+5511", email: "a@x" },
    ]);
    expect(partnerBrokersFromData({})).toEqual([]);
    expect(partnerBrokersFromData(null)).toEqual([]);
  });
});

describe("partner-brokers — validação", () => {
  it("ok com dados válidos e com campos opcionais vazios", () => {
    expect(validatePartnerBrokers([parceiro()])).toEqual([]);
    expect(validatePartnerBrokers([parceiro({ creci: "", phone: "", email: "" })])).toEqual([]);
  });

  it("CRECI, telefone e e-mail inválidos viram mensagens; nome identifica a linha", () => {
    const issues = validatePartnerBrokers([
      parceiro({ creci: "abc" }),
      parceiro({ nome: "Beto", phone: "12" }),
      parceiro({ nome: "Cida", email: "nao-e-email" }),
    ]);
    expect(issues).toEqual([
      "CRECI inválido para Carla Parceira.",
      "Telefone inválido para Beto.",
      "E-mail inválido para Cida.",
    ]);
  });

  it("tamanhos: nome longo e e-mail longo são recusados", () => {
    expect(validatePartnerBrokers([parceiro({ nome: "x".repeat(121) })])[0]).toMatch(
      /Nome longo/
    );
    expect(
      validatePartnerBrokers([parceiro({ email: `${"a".repeat(160)}@x.com` })])[0]
    ).toMatch(/E-mail inválido/);
  });

  it("teto de parceiros", () => {
    const many = Array.from({ length: MAX_PARTNER_BROKERS + 1 }, (_, i) =>
      parceiro({ nome: `P${i}`, creci: "", phone: "", email: "" })
    );
    expect(validatePartnerBrokers(many)[0]).toMatch(/No máximo/);
  });

  it("validateInData olha só corretores_parceiros", () => {
    expect(
      validatePartnerBrokersInData({ corretores_parceiros: [{ nome: "X", creci: "abc" }] })
    ).toHaveLength(1);
    expect(
      validatePartnerBrokersInData({ comissao: { comissionados: [{ nome: "X", creci: "abc" }] } })
    ).toEqual([]);
  });
});

describe("partner-brokers — round-trip pelo form da proposta", () => {
  it("venda: parceiros vão para corretores_parceiros e NÃO tocam comissao", () => {
    const v = {
      ...emptyProposalForm("venda", "compra_venda_v1"),
      proponentes: [proponente],
      corretoresParceiros: [parceiro()],
    };
    const data = buildProposalDataJson(v) as Record<string, unknown>;
    expect(data.corretores_parceiros).toEqual([
      {
        nome: "Carla Parceira",
        creci: "123456-F/SP",
        mobile_phone: "+5511999990001",
        email: "carla@parceira.com",
        papel: PARTNER_BROKER_DEFAULT_PAPEL,
      },
    ]);
    expect(data.comissao).toBeUndefined();
  });

  it("locação: mesma chave, e volta pelo parse da edição", () => {
    const v = {
      ...emptyProposalForm("locacao", "locacao_residencial_v1"),
      proponentes: [{ ...proponente, nome: "Maria" }],
      corretoresParceiros: [parceiro({ splitRecipientId: "sr-9" })],
    };
    const data = buildProposalDataJson(v) as Record<string, unknown>;
    expect(data.corretores_parceiros).toHaveLength(1);

    const back = parseProposalForm({
      kind: "locacao",
      schemaType: "locacao_residencial_v1",
      dataJson: data,
      validUntil: null,
      comissaoIncluida: false,
      hiddenPaths: [],
      signers: [],
    });
    expect(back.corretoresParceiros).toEqual([
      {
        splitRecipientId: "sr-9",
        nome: "Carla Parceira",
        creci: "123456-F/SP",
        phone: "+5511999990001",
        email: "carla@parceira.com",
      },
    ]);
  });

  it("sem parceiros não cria a chave", () => {
    const v = { ...emptyProposalForm("venda", "compra_venda_v1"), proponentes: [proponente] };
    expect((buildProposalDataJson(v) as Record<string, unknown>).corretores_parceiros).toBeUndefined();
  });
});
