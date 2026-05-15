import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Unmock handlebars to test real rendering
vi.unmock("@/lib/render/handlebars");

import { renderContratoHTML } from "@/lib/render/handlebars";
import { enrichContractData } from "@/lib/services/contract-generation";

// Helper que mimica o fluxo de produção: data do form → enrich → render.
// SEMPRE usar esse helper nos testes pra garantir que estamos exercitando
// o mesmo pipeline que generateContractForDeal executa.
// Passa um deep clone da data porque enrichContractData muta `config` nested —
// sem isso, fixtures reusadas vazam estado entre testes (ex.: config.saldo_devedor_vendedor
// setado num test fica visível pro próximo). Em prod, dataJson é JSON do DB,
// sem compartilhamento, então o JSON.parse(JSON.stringify(...)) só é defensivo aqui.
function renderWithEnrich(template: string, data: Record<string, unknown>): string {
  const cloned = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const enriched = enrichContractData(cloned);
  return renderContratoHTML(template, enriched as Record<string, unknown>);
}

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
  // Saldo devedor no caminho TOP-LEVEL — exatamente como o form Zod salva
  // (step4Schema.saldo_devedor). enrichContractData mapeia pra
  // config.saldo_devedor_vendedor antes do render.
  saldo_devedor: 150000,
  status_propriedade: "financiado-saldo",
  // Bens inclusos no caminho TOP-LEVEL (step5Schema.incluso_no_preco).
  incluso_no_preco:
    "armários embutidos da cozinha e quartos, vasos sanitários, pias, metálicos, lustres da sala e quartos",
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
    banco_financiamento: "Banco Itaú S/A",
    data_referencia_saldo: "2026-03-15",
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
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toBeTruthy();
      expect(html.length).toBeGreaterThan(1000);
    });

    it("should contain vendedor qualification with CPF formatted", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("João Carlos da Silva");
      expect(html).toContain("529.982.247-25"); // formatted CPF
    });

    it("should contain comprador qualification", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("Ana Paula Oliveira");
    });

    it("should contain conjuge info for married vendedor", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("Maria Helena da Silva");
    });

    it("should render payment value with moeda helper", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("R$"); // moeda helper output
      expect(html).toContain("600.000"); // valor_total formatted
    });

    it("should render extenso helper for payment", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("seiscentos mil reais");
    });

    it("should contain imovel address and matricula", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("Rua Augusta");
      expect(html).toContain("12345"); // matricula
      expect(html).toContain("01305-100"); // CEP formatted
    });

    it("should contain CLAUSE_SLOT comments for variable clauses", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("<!-- CLAUSE_SLOT:G1 -->");
      expect(html).toContain("<!-- CLAUSE_SLOT:G2 -->");
      expect(html).toContain("<!-- CLAUSE_SLOT:G3 -->");
    });

    it("should render 15 main sections (CLÁUSULA)", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      // Count CLÁUSULA occurrences in headings
      const clauseMatches = html.match(/CLÁUSULA/gi);
      expect(clauseMatches).toBeTruthy();
      expect(clauseMatches!.length).toBeGreaterThanOrEqual(15);
    });

    it("should contain CNPJ for intermediadora", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("Zimmermann");
      expect(html).toContain("12.345.678/0001-90"); // CNPJ formatted
    });

    it("should render foro clause for justica publica", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("foro da situação do imóvel");
    });
  });

  describe("CCV Financiamento", () => {
    it("should render without errors", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderWithEnrich(template,mockDataFinanciamento);
      expect(html).toBeTruthy();
      expect(html.length).toBeGreaterThan(1000);
    });

    it("should contain financing-specific payment section", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderWithEnrich(template,mockDataFinanciamento);
      // Should have financing amount
      expect(html).toContain("500.000"); // alienacao_fiduciaria
    });

    it("should contain FGTS section when fgts > 0", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderWithEnrich(template,mockDataFinanciamento);
      expect(html).toContain("40.000"); // FGTS value
    });

    it("should contain G4 CLAUSE_SLOT for financiamento clauses", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderWithEnrich(template,mockDataFinanciamento);
      expect(html).toContain("<!-- CLAUSE_SLOT:G4 -->");
    });

    it("should contain saldo devedor info", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderWithEnrich(template,mockDataFinanciamento);
      expect(html).toContain("150.000"); // saldo_devedor_vendedor
    });

    it("should have more sections than a_vista (17 vs 15)", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderWithEnrich(template,mockDataFinanciamento);
      const clauseMatches = html.match(/CLÁUSULA/gi);
      expect(clauseMatches).toBeTruthy();
      expect(clauseMatches!.length).toBeGreaterThanOrEqual(17);
    });

    it("should contain rescisao por nao obtencao de financiamento (9.5)", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const html = renderWithEnrich(template,mockDataFinanciamento);
      expect(html).toContain("financiamento imobiliário");
      expect(html).toContain("restituição integral e sem penalidades");
    });

    it("should render vendedor and comprador blocks identically to a_vista", () => {
      const templateAVista = loadTemplate("ccv_a_vista_v2.hbs");
      const templateFin = loadTemplate("ccv_financiamento_v2.hbs");
      const htmlAVista = renderWithEnrich(templateAVista,mockDataAVista);
      const htmlFin = renderWithEnrich(templateFin,mockDataFinanciamento);
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
      // Stub de cláusula G4 que lê config.saldo_devedor_vendedor — esse campo
      // é populado por enrichContractData a partir de data.saldo_devedor.
      // Como o stub não passa pelo template completo, aplicamos enrich aqui.
      const clauseContent = `<p>Saldo devedor junto à {{config.banco_financiamento}}, no valor de {{moeda config.saldo_devedor_vendedor}}.</p>`;
      const enriched = enrichContractData(
        JSON.parse(JSON.stringify(mockDataFinanciamento)) as Record<string, unknown>
      );
      const html = renderContratoHTML(clauseContent, enriched as Record<string, unknown>);
      expect(html).toContain("Banco Itaú S/A");
      expect(html).toContain("150.000");
    });
  });

  describe("Intermediadora — PF vs PJ", () => {
    it("renders Corretor PF block with CPF (à vista)", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        comissao: {
          ...mockDataAVista.comissao,
          corretora_tipo_pessoa: "fisica",
          imobiliaria_nome: "Carlos Henrique Souza",
          imobiliaria_cnpj: "52998224725", // 11 dígitos = CPF
          creci: "199.905",
        },
      };
      const html = renderWithEnrich(template,data);
      expect(html).toContain("Corretor(a): Carlos Henrique Souza");
      expect(html).toContain("CPF: 529.982.247-25");
      expect(html).not.toMatch(/Imobili[áa]ria:\s*Carlos/);
    });

    it("renders Imobiliária PJ block with CNPJ (à vista)", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        comissao: {
          ...mockDataAVista.comissao,
          corretora_tipo_pessoa: "juridica",
        },
      };
      const html = renderWithEnrich(template,data);
      expect(html).toContain("Imobiliária: Zimmermann Imóveis Ltda");
      expect(html).toContain("CNPJ: nº 12.345.678/0001-90");
      expect(html).not.toContain("Corretor(a):");
    });

    it("renders Corretor PF with CPF in financiamento clause 14.1", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const data = {
        ...mockDataFinanciamento,
        comissao: {
          ...mockDataFinanciamento.comissao,
          corretora_tipo_pessoa: "fisica",
          imobiliaria_nome: "Lucas Pereira",
          imobiliaria_cnpj: "52998224725",
        },
      };
      const html = renderWithEnrich(template,data);
      expect(html).toContain("ao(à) corretor(a) Lucas Pereira");
      expect(html).toContain("inscrito(a) no CPF nº 529.982.247-25");
    });
  });

  describe("Parcelas dinâmicas", () => {
    it("renders parcelas as alíneas b/c/d in à vista when 3 parcelas", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        pagamento: {
          ...mockDataAVista.pagamento,
          parcelas: [
            { tipo_texto: "Parcela 1", dias: 30, valor: 100000, letra: "b", numero: 1 },
            { tipo_texto: "Parcela 2", dias: 60, valor: 100000, letra: "c", numero: 2 },
            { tipo_texto: "Parcela 3", dias: 90, valor: 100000, letra: "d", numero: 3 },
          ],
        },
      };
      const html = renderWithEnrich(template,data);
      expect(html).toContain("<strong>b)</strong> Parcela 1:");
      expect(html).toContain("<strong>c)</strong> Parcela 2:");
      expect(html).toContain("<strong>d)</strong> Parcela 3:");
      expect(html).toContain("em 30 dia");
      expect(html).toContain("em 60 dia");
      expect(html).toContain("em 90 dia");
      // Sem parcelas, cairia no fallback "O saldo remanescente de {moeda}" — esse
      // texto específico (com "de " seguido por valor) NÃO deve aparecer.
      // Outras menções a "saldo remanescente" em cláusulas de rescisão são OK.
      expect(html).not.toMatch(/saldo remanescente de R\$/);
    });

    it("renders parcelas as 'Parcela N' in financiamento", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const data = {
        ...mockDataFinanciamento,
        pagamento: {
          ...mockDataFinanciamento.pagamento,
          parcelas: [
            { tipo_texto: "Reforço", dias: 180, valor: 30000, letra: "b", numero: 1 },
            { tipo_texto: "Reforço final", dias: 360, valor: 30000, letra: "c", numero: 2 },
          ],
        },
      };
      const html = renderWithEnrich(template,data);
      expect(html).toContain("<strong>Parcela 1.</strong> Reforço:");
      expect(html).toContain("<strong>Parcela 2.</strong> Reforço final:");
    });

    it("falls back to 'saldo remanescente' when parcelas empty", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      // mockDataAVista already has parcelas: []
      const html = renderWithEnrich(template,mockDataAVista);
      expect(html).toContain("saldo remanescente");
    });
  });

  describe("Múltiplos vendedores casados", () => {
    it("renders qualificação and assinatura blocks for each vendedor + cônjuge", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        vendedores: [
          {
            ...mockDataAVista.vendedores[0],
            nome: "Vendedor Um",
            cpf: "12345678909",
            conjuge: { ...mockDataAVista.vendedores[0].conjuge, nome: "Cônjuge Um", cpf: "98765432100" },
          },
          {
            ...mockDataAVista.vendedores[0],
            nome: "Vendedor Dois",
            cpf: "11122233344",
            conjuge: { ...mockDataAVista.vendedores[0].conjuge, nome: "Cônjuge Dois", cpf: "55566677788" },
          },
        ],
      };
      const html = renderWithEnrich(template,data);
      expect(html).toContain("Vendedor Um");
      expect(html).toContain("Vendedor Dois");
      expect(html).toContain("Cônjuge Um");
      expect(html).toContain("Cônjuge Dois");
    });

    it("does NOT render conjuge block for solteiro", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        compradores: [
          {
            ...mockDataAVista.compradores[0],
            estado_civil: "Solteiro(a)",
            // garante que campos do conjuge não vazem
            conjuge: undefined,
          },
        ],
      };
      const html = renderWithEnrich(template,data);
      // Não deve ter (Cônjuge/Companheiro) na seção de comprador
      const compradorSection = html.split("PARTE COMPRADORA")[1] ?? "";
      expect(compradorSection).not.toContain("(Cônjuge/Companheiro)");
    });
  });

  describe("Inscrição municipal duplicada vs distinta", () => {
    it("renders inscrição municipal when distinct from inscricao_iptu", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        imoveis: [
          {
            ...mockDataAVista.imoveis[0],
            inscricao_iptu: "300.123.0001-0",
            inscricao_municipal: "MUN-99887",
          },
        ],
      };
      const html = renderWithEnrich(template,data);
      expect(html).toContain("Inscrição Municipal: nº MUN-99887");
    });

    it("omits inscrição municipal when equal to inscricao_iptu", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        imoveis: [
          {
            ...mockDataAVista.imoveis[0],
            inscricao_iptu: "300.123.0001-0",
            inscricao_municipal: "300.123.0001-0",
          },
        ],
      };
      const html = renderWithEnrich(template,data);
      expect(html).not.toContain("Inscrição Municipal:");
    });
  });

  // Regressão do caso Aide (2026-05-15): saldo_devedor preenchido no form
  // sumia do contrato porque o template lê config.saldo_devedor_vendedor
  // mas o form salva em data.saldo_devedor top-level. enrichContractData
  // agora faz a ponte. Não remova esses testes sem checar com o caso.
  describe("Form → template field bridges (caso Aide e correlatos)", () => {
    it("financiamento: saldo_devedor top-level → cláusula 2.1.4 com valor formatado", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const data = {
        ...mockDataFinanciamento,
        saldo_devedor: 200000,
        // garante que não há valor em config.saldo_devedor_vendedor — enrich precisa popular
        config: { ...mockDataFinanciamento.config, saldo_devedor_vendedor: undefined },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("200.000");
      expect(html).toContain("duzentos mil reais");
      expect(html).toContain("saldo devedor de alienação fiduciária");
    });

    it("à vista: saldo_devedor top-level → cláusula 2.1.3 com quitação prévia", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = { ...mockDataAVista, saldo_devedor: 80000 };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("2.1.3.");
      expect(html).toContain("80.000");
      expect(html).toContain("quitação");
    });

    it("debitos.iptu.selecionado=true com valor → cláusula 5.2 renderiza IPTU", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        tem_debitos: true,
        debitos: {
          iptu: { selecionado: true, valor: 3500 },
          condominio: { selecionado: false, valor: 0 },
          outros: "",
        },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("5.2.");
      expect(html).toContain("IPTU em atraso");
      expect(html).toContain("3.500");
    });

    it("vicios.opcao='reparar' com descrição → cláusula 10.4 lista os reparos", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        vicios: {
          opcao: "reparar",
          descricao_reparar: "trocar telhado e impermeabilizar laje",
        },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("10.4.");
      expect(html).toContain("trocar telhado e impermeabilizar laje");
      // Não deve ter o texto das outras variantes
      expect(html).not.toContain("renunciando expressamente ao direito de pleitear");
    });

    it("vicios.opcao='renuncia' → cláusula 10.4 com texto de renúncia, sem mencionar reparos", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = { ...mockDataAVista, vicios: { opcao: "renuncia" } };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("10.4.");
      expect(html).toContain("renunciando expressamente");
      expect(html).not.toContain("trocar telhado");
    });

    it("incluso_no_preco top-level → cláusula de bens inclusos renderiza", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        incluso_no_preco: "armários da cozinha e ar-condicionado",
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("3.4.");
      expect(html).toContain("armários da cozinha e ar-condicionado");
    });

    it("regularizacoes com prazo customizado → cláusula 5.4 usa o prazo informado", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        regularizacoes: {
          tem: true,
          prazo_dias: 60,
          descricao: "averbar ampliação na matrícula",
        },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("5.4.");
      expect(html).toContain("averbar ampliação na matrícula");
      expect(html).toContain("60");
    });

    it("debitos_assumidos.assume=true → cláusula 5.3 em derrogação à 5.2", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        tem_debitos: true,
        debitos: {
          iptu: { selecionado: true, valor: 1500 },
          condominio: { selecionado: false, valor: 0 },
          outros: "",
        },
        debitos_assumidos: {
          assume: true,
          descricao: "IPTU em atraso de 2025",
        },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("5.3.");
      expect(html).toContain("IPTU em atraso de 2025");
      expect(html).toContain("derrogação");
    });

    it("ocupacao='ocupado-terceiro' + locacao.situacao='vendedor-entregara' → cláusula 3.3 desocupação", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        ocupacao: "ocupado-terceiro",
        locacao: { situacao: "vendedor-entregara", data_preferencia: "30/06/2026" },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("3.3.");
      expect(html).toContain("desocupado");
      expect(html).toContain("30/06/2026");
    });

    it("desistencia.permite=true → cláusula 9.5 com prazo informado", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const data = {
        ...mockDataAVista,
        desistencia: { permite: true, prazo_dias: 14 },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("9.5.");
      expect(html).toContain("direito de desistência");
      expect(html).toContain("14");
    });

    it("parcelas[].tipo='financiamento' soma → pagamento.alienacao_fiduciaria via bucket", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const data = {
        ...mockDataFinanciamento,
        pagamento: {
          ...mockDataFinanciamento.pagamento,
          alienacao_fiduciaria: 0, // zerado — bucket deve preencher a partir das parcelas
          parcelas: [
            { tipo: "financiamento", valor: 400000, momento: "registro", tipo_texto: "" },
          ],
        },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("400.000");
      expect(html).toContain("Financiamento imobiliário com alienação fiduciária");
    });

    it("parcelas[].tipo='permuta_imovel' → cláusula 2.1.5 (financiamento) com descrição da permuta", () => {
      const template = loadTemplate("ccv_financiamento_v2.hbs");
      const data = {
        ...mockDataFinanciamento,
        pagamento: {
          ...mockDataFinanciamento.pagamento,
          parcelas: [
            {
              tipo: "permuta_imovel",
              valor: 200000,
              permuta_descricao: "apartamento em São Caetano matrícula 12345",
            },
          ],
        },
      };
      const html = renderWithEnrich(template, data);
      expect(html).toContain("2.1.5.");
      expect(html).toContain("permuta");
      expect(html).toContain("apartamento em São Caetano matrícula 12345");
    });

    it("enrichContractData é idempotente — segunda execução não duplica", () => {
      const fresh = JSON.parse(
        JSON.stringify({ ...mockDataFinanciamento, saldo_devedor: 100000 })
      ) as Record<string, unknown>;
      const once = enrichContractData(fresh);
      const twice = enrichContractData(once as Record<string, unknown>);
      const c1 = (once as any).config as Record<string, unknown>;
      const c2 = (twice as any).config as Record<string, unknown>;
      expect(c1.saldo_devedor_vendedor).toBe(100000);
      expect(c2.saldo_devedor_vendedor).toBe(100000);
    });

    it("contrato sem nenhum campo rich → cláusulas opcionais não aparecem (a_vista)", () => {
      const template = loadTemplate("ccv_a_vista_v2.hbs");
      const html = renderWithEnrich(template, mockDataAVista);
      // mockDataAVista é o caso "happy" sem saldo/debitos/vicios/regularizacoes —
      // as cláusulas opcionais devem ficar invisíveis.
      expect(html).not.toContain("2.1.3.");
      expect(html).not.toContain("3.3.");
      expect(html).not.toContain("3.4.");
      expect(html).not.toContain("5.2.");
      expect(html).not.toContain("5.3.");
      expect(html).not.toContain("5.4.");
      expect(html).not.toContain("9.5.");
      expect(html).not.toContain("10.4.");
    });
  });
});
