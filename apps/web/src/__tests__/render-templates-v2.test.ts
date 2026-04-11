import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Unmock handlebars to test real rendering
vi.unmock("@/lib/render/handlebars");

import { renderContratoHTML } from "@/lib/render/handlebars";

// Realistic mock data matching DadosContrato structure
const mockDataAVista = {
  modalidade: "a_vista",
  vendedores: [
    {
      tipo_pessoa: "fisica",
      nome: "João Carlos da Silva",
      nacionalidade: "brasileiro",
      estado_civil: "Casado(a)",
      profissao: "Engenheiro Civil",
      rg: "12.345.678-9",
      cpf: "52998224725",
      email: "joao@email.com",
      endereco: "Rua das Flores",
      numero: "123",
      complemento: "Apto 45",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01234567",
      conjuge: {
        nome: "Maria Helena da Silva",
        cpf: "45317828791",
        rg: "98.765.432-1",
        nacionalidade: "brasileira",
        profissao: "Advogada",
      },
      tem_procurador: false,
    },
  ],
  compradores: [
    {
      tipo_pessoa: "fisica",
      nome: "Ana Paula Oliveira",
      nacionalidade: "brasileira",
      estado_civil: "Solteiro(a)",
      profissao: "Médica",
      rg: "11.222.333-4",
      cpf: "12345678909",
      email: "ana@email.com",
      endereco: "Av. Brasil",
      numero: "456",
      complemento: "",
      cidade: "São Paulo",
      uf: "SP",
      cep: "04567890",
      tem_procurador: false,
    },
  ],
  imoveis: [
    {
      rua: "Rua Augusta",
      numero: "1000",
      complemento: "Sala 101",
      bairro: "Consolação",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01305100",
      matricula: "12345",
      cartorio: "1º Cartório de Registro de Imóveis de São Paulo",
      inscricao_iptu: "300.123.0001-0",
      descricao: "Apartamento com 80m², 2 quartos, 1 vaga de garagem",
    },
  ],
  titulo_aquisitivo: "Escritura Pública de Compra e Venda",
  registro_aquisitivo: "R.10/12345",
  observacao_imovel: "Imóvel em bom estado de conservação.",
  pagamento: {
    valor_total: 600000,
    sinal_arras: 60000,
    recursos_proprios: 540000,
    fgts: 0,
    cessao_consorcio: 0,
    alienacao_fiduciaria: 0,
    outras_formas: 0,
    meio_pagamento: "transferência bancária via TED ou Pix",
    parcelas: [],
  },
  comissao: {
    valor: 36000,
    percentual: 6,
    quem_paga_texto: "PROMITENTES VENDEDORES",
    imobiliaria_nome: "Zimmermann Imóveis Ltda",
    imobiliaria_cnpj: "12345678000190",
    creci: "J-12345",
    dominio_imobiliaria: "zimmermann.com.br",
    quando_paga_texto: "no ato do recebimento do saldo",
  },
  config: {
    prazo_posse_dias: 30,
    multa_diaria_posse: 500,
    prazo_escritura_dias: 60,
    multa_diaria_escritura: 500,
    multa_penal_moratoria: 2,
    juros_mensais_atraso: 1,
    atualizacao_monetaria: "IPCA",
    prazo_atraso_rescisao: 15,
    multa_cominatoria_diaria: 500,
    multa_penal_compensatoria: 5,
    base_calculo_multa: "valor do contrato",
    prazo_multa_rescisoria: 5,
    municipio_imovel: "São Paulo",
    data_assinatura: "2026-04-10",
  },
  foro: "justica-publica",
};

const mockDataFinanciamento = {
  ...mockDataAVista,
  modalidade: "financiamento",
  pagamento: {
    valor_total: 600000,
    sinal_arras: 60000,
    recursos_proprios: 0,
    fgts: 40000,
    cessao_consorcio: 0,
    alienacao_fiduciaria: 500000,
    outras_formas: 0,
    meio_pagamento: "transferência bancária via TED ou Pix",
    parcelas: [],
  },
  config: {
    ...mockDataAVista.config,
    saldo_devedor_vendedor: 150000,
    banco_financiamento: "Banco Itaú S/A",
    data_referencia_saldo: "2026-03-15",
    itens_entrega:
      "armários embutidos da cozinha e quartos, vasos sanitários, pias, metálicos, lustres da sala e quartos",
    data_posse_precaria: "2026-05-15",
  },
};

function loadTemplate(name: string): string {
  const templatePath = path.resolve(
    __dirname,
    "../../../../templates",
    name
  );
  return fs.readFileSync(templatePath, "utf-8");
}

describe("Template v2 Rendering", () => {
  describe("CCV À Vista", () => {
    it("should render without errors", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toBeTruthy();
      expect(html.length).toBeGreaterThan(1000);
    });

    it("should contain vendedor qualification with CPF formatted", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("João Carlos da Silva");
      expect(html).toContain("529.982.247-25"); // formatted CPF
    });

    it("should contain comprador qualification", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("Ana Paula Oliveira");
    });

    it("should contain conjuge info for married vendedor", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("Maria Helena da Silva");
    });

    it("should render payment value with moeda helper", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("R$"); // moeda helper output
      expect(html).toContain("600.000"); // valor_total formatted
    });

    it("should render extenso helper for payment", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("seiscentos mil reais");
    });

    it("should contain imovel address and matricula", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("Rua Augusta");
      expect(html).toContain("12345"); // matricula
      expect(html).toContain("01305-100"); // CEP formatted
    });

    it("should contain CLAUSE_SLOT comments for variable clauses", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("<!-- CLAUSE_SLOT:G1 -->");
      expect(html).toContain("<!-- CLAUSE_SLOT:G2 -->");
      expect(html).toContain("<!-- CLAUSE_SLOT:G3 -->");
    });

    it("should render 15 main sections (CLÁUSULA)", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      // Count CLÁUSULA occurrences in headings
      const clauseMatches = html.match(/CLÁUSULA/gi);
      expect(clauseMatches).toBeTruthy();
      expect(clauseMatches!.length).toBeGreaterThanOrEqual(15);
    });

    it("should contain CNPJ for intermediadora", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("Zimmermann");
      expect(html).toContain("12.345.678/0001-90"); // CNPJ formatted
    });

    it("should render foro clause for justica publica", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderContratoHTML(template, mockDataAVista);
      expect(html).toContain("foro da situação do imóvel");
    });
  });

  describe("CCV Financiamento", () => {
    it("should render without errors", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderContratoHTML(template, mockDataFinanciamento);
      expect(html).toBeTruthy();
      expect(html.length).toBeGreaterThan(1000);
    });

    it("should contain financing-specific payment section", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderContratoHTML(template, mockDataFinanciamento);
      // Should have financing amount
      expect(html).toContain("500.000"); // alienacao_fiduciaria
    });

    it("should contain FGTS section when fgts > 0", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderContratoHTML(template, mockDataFinanciamento);
      expect(html).toContain("40.000"); // FGTS value
    });

    it("should contain G4 CLAUSE_SLOT for financiamento clauses", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderContratoHTML(template, mockDataFinanciamento);
      expect(html).toContain("<!-- CLAUSE_SLOT:G4 -->");
    });

    it("should contain saldo devedor info", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderContratoHTML(template, mockDataFinanciamento);
      expect(html).toContain("150.000"); // saldo_devedor_vendedor
    });

    it("should have more sections than a_vista (17 vs 15)", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderContratoHTML(template, mockDataFinanciamento);
      const clauseMatches = html.match(/CLÁUSULA/gi);
      expect(clauseMatches).toBeTruthy();
      expect(clauseMatches!.length).toBeGreaterThanOrEqual(17);
    });

    it("should contain rescisao por nao obtencao de financiamento (9.5)", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderContratoHTML(template, mockDataFinanciamento);
      expect(html).toContain("financiamento imobiliário");
      expect(html).toContain("restituição integral e sem penalidades");
    });

    it("should render vendedor and comprador blocks identically to a_vista", () => {
      const templateAVista = loadTemplate("ccv_a_vista_v2.hbs");
      const templateFin = loadTemplate("ccv_financiamento_v2.hbs");
      const htmlAVista = renderContratoHTML(templateAVista, mockDataAVista);
      const htmlFin = renderContratoHTML(templateFin, mockDataFinanciamento);
      // Both should contain the same vendedor
      expect(htmlAVista).toContain("João Carlos da Silva");
      expect(htmlFin).toContain("João Carlos da Silva");
      // Both should format CPF the same
      expect(htmlAVista).toContain("529.982.247-25");
      expect(htmlFin).toContain("529.982.247-25");
    });
  });

  describe("Clause rendering with template data", () => {
    it("should render a G1 clause with contract data", () => {
      const clauseContent = `<p>O valor de {{moeda pagamento.sinal_arras}} ({{extenso pagamento.sinal_arras}}), pago nesta data a título de sinal.</p>`;
      const html = renderContratoHTML(clauseContent, mockDataAVista);
      expect(html).toContain("R$");
      expect(html).toContain("60.000");
      expect(html).toContain("sessenta mil reais");
    });

    it("should render a G4 clause with financing data", () => {
      const clauseContent = `<p>Saldo devedor junto à {{config.banco_financiamento}}, no valor de {{moeda config.saldo_devedor_vendedor}}.</p>`;
      const html = renderContratoHTML(clauseContent, mockDataFinanciamento);
      expect(html).toContain("Banco Itaú S/A");
      expect(html).toContain("150.000");
    });
  });
});
