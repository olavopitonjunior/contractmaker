import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Unmock handlebars pra testar o render real (o setup global o stuba).
vi.unmock("@/lib/render/handlebars");

import { renderContratoHTML } from "@/lib/render/handlebars";
import { enrichLocacaoData } from "../enrich";
import {
  dadosLocacaoSchema,
  dadosLocacaoComercialSchema,
} from "@/lib/forms/validation-locacao";

function loadTemplate(filename = "locacao_residencial_v3.hbs"): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", filename),
    path.join(process.cwd(), "templates", filename),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c, "utf-8");
  throw new Error(`template ${filename} não encontrado`);
}

const sample = dadosLocacaoSchema.parse({
  locadores: [
    {
      tipo_pessoa: "fisica",
      nome: "João da Silva Locador",
      cpf: "12345678901",
      cidade: "São Paulo",
      uf: "SP",
    },
  ],
  locatarios: [
    {
      tipo_pessoa: "fisica",
      nome: "Maria Souza Locatária",
      cpf: "98765432100",
    },
  ],
  imovel: {
    rua: "Rua das Flores",
    numero: "100",
    cidade: "São Paulo",
    uf: "SP",
    cep: "01234567",
    vagas_garagem: 2,
    descricao: "Apartamento de 2 quartos, 1 vaga, no 3º andar.",
  },
  aluguel: {
    valor: 2500,
    encargos: 400,
    dia_vencimento: 10,
    indice_reajuste: "IPCA",
    vigencia_inicio: "2026-06-01",
    vigencia_meses: 30,
    meio_pagamento: "pix",
  },
  garantia: { tipo: "caucao", caucao_meses: 3 },
  assinatura: { cidade: "São Paulo", uf: "SP", data: "2026-05-27" },
});

describe("template locação residencial v3 + enrich", () => {
  const html = renderContratoHTML(loadTemplate(), enrichLocacaoData(sample as Record<string, unknown>));

  it("renderiza sem placeholders Handlebars não resolvidos", () => {
    expect(html).not.toMatch(/\{\{/);
  });

  it("inclui partes, imóvel e valor formatado em BRL", () => {
    expect(html).toContain("João da Silva Locador");
    expect(html).toContain("Maria Souza Locatária");
    expect(html).toContain("Apartamento de 2 quartos");
    expect(html).toContain("R$");
    expect(html).toContain("2.500");
  });

  it("usa o índice de reajuste escolhido (IPCA)", () => {
    expect(html).toContain("IPCA");
  });

  it("renderiza a cláusula de caução (3 aluguéis) e não a de fiador", () => {
    expect(html).toContain("título de caução");
    expect(html).not.toContain("FIADOR(A)");
  });

  it("preenche município e data do fecho via enrich", () => {
    expect(html).toContain("São Paulo/SP");
    expect(html).toMatch(/de maio de 2026/);
  });

  it("foro sem preenchimento usa o fallback 'comarca de localização do imóvel'", () => {
    expect(html).toContain("comarca de localização do imóvel");
  });

  it("multa de atraso default da casa é 10% (modelo NNI)", () => {
    expect(html).toContain("10% (dez por cento)");
  });

  it("sem administradora usa o fallback genérico e omite a cláusula de boleto consolidado", () => {
    expect(html).toContain("diretamente à PARTE LOCADORA ou a quem esta indicar");
    expect(html).not.toContain("no mesmo boleto");
  });

  it("usa a terminologia literal do modelo (PARTE LOCADORA/LOCATÁRIA, preâmbulo, fecho)", () => {
    expect(html).toContain("PARTE LOCADORA");
    expect(html).toContain("PARTE LOCATÁRIA");
    expect(html).toContain("têm entre si, justo e acertado o seguinte:");
    expect(html).toContain("em 03 (três) vias de igual teor e forma");
    // 2026-08: concessionárias hardcoded (ENEL/SABESP/COMGÁS, viés SP) viraram
    // texto genérico — o form agora decide individualização das contas.
    expect(html).toContain(
      "concessionárias de energia elétrica, água (se houver) e gás (se houver)"
    );
    expect(html).toContain("Testemunha");
  });

  it("inclui as cláusulas fixas do modelo NNI (seguro incêndio 100x, honorários 20%)", () => {
    expect(html).toContain("100 (cem) vezes o valor do aluguel");
    expect(html).toContain("20% (vinte por cento)");
  });

  it("flexiona vagas de garagem no feminino (duas, não dois)", () => {
    expect(html).toContain("com 2 (duas) vaga(s) de garagem");
  });
});

describe("helper numeroExtenso — flexão de gênero", () => {
  const render = (tpl: string, data: Record<string, unknown>) =>
    renderContratoHTML(tpl, data);

  it("default continua masculino (aditivo)", () => {
    expect(render("{{numeroExtenso n}}", { n: 2 })).toBe("dois");
    expect(render("{{numeroExtenso n}}", { n: 21 })).toBe("vinte e um");
  });

  it('"f" flexiona unidades e centenas', () => {
    expect(render('{{numeroExtenso n "f"}}', { n: 1 })).toBe("uma");
    expect(render('{{numeroExtenso n "f"}}', { n: 2 })).toBe("duas");
    expect(render('{{numeroExtenso n "f"}}', { n: 22 })).toBe("vinte e duas");
    expect(render('{{numeroExtenso n "f"}}', { n: 301 })).toBe("trezentas e uma");
  });

  it('"f" flexiona antes de mil, mas não antes de milhões', () => {
    expect(render('{{numeroExtenso n "f"}}', { n: 2000 })).toBe("duas mil");
    expect(render('{{numeroExtenso n "f"}}', { n: 2000000 })).toBe("dois milhões");
  });
});

describe("template locação residencial v3 — administradora + título de capitalização", () => {
  const data = dadosLocacaoSchema.parse({
    ...sample,
    garantia: {
      tipo: "titulo_capitalizacao",
      provider: "Porto Seguro Capitalização S.A.",
      titulo_valor: 15000,
      titulo_proposta: "1234567-001",
    },
  });
  const enriched = enrichLocacaoData(data as Record<string, unknown>, {
    administradora: {
      nome: "Imobiliária Exemplo Ltda",
      creci: "24.342-J/SP",
      endereco: "Rua Roque Petrella, 188, São Paulo/SP",
    },
  });
  const html = renderContratoHTML(loadTemplate(), enriched);

  it("renderiza sem placeholders não resolvidos", () => {
    expect(html).not.toMatch(/\{\{/);
  });

  it("nomeia a administradora com CRECI e sede na cláusula de pagamento", () => {
    expect(html).toContain("Imobiliária Exemplo Ltda");
    expect(html).toContain("CRECI sob nº 24.342-J/SP");
    expect(html).toContain("Rua Roque Petrella, 188");
    expect(html).toContain("administração da presente locação");
  });

  it("com administradora inclui IPTU/condomínio no mesmo boleto (9.1.2/9.1.3)", () => {
    expect(html).toContain("no mesmo boleto");
    expect(html).toContain("pagos a vencer");
  });

  it("renderiza a garantia por título de capitalização (8.1–8.6)", () => {
    expect(html).toContain("Título de Capitalização");
    expect(html).toContain("15.000");
    expect(html).toContain("Porto Seguro Capitalização S.A.");
    expect(html).toContain("proposta/formulário n.º 1234567-001");
    expect(html).toContain("REAPLICAR");
    expect(html).toContain("15 (quinze) dias de antecedência");
    expect(html).toContain("documento rescisório");
    expect(html).toContain("resgatar o(s) Título(s) caucionado(s)");
    expect(html).toContain("prestação de contas");
  });

  it("garantia capitalização não renderiza os ramos de fiador/caução", () => {
    expect(html).not.toContain("benefício de ordem");
    expect(html).not.toContain("título de caução");
  });
});

describe("template locação comercial v3", () => {
  const data = dadosLocacaoComercialSchema.parse({
    ...sample,
    imovel: {
      kind: "comercial_sala",
      rua: "Rua Augusta",
      numero: "1200",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01304001",
      descricao: "Loja com vitrine e mezanino.",
      destinacao: "comércio varejista de vestuário",
    },
    garantia: { tipo: "fiador", fiador: { tipo_pessoa: "fisica", nome: "Fulano Fiador" } },
  });
  const html = renderContratoHTML(
    loadTemplate("locacao_comercial_v3.hbs"),
    enrichLocacaoData(data as Record<string, unknown>)
  );

  it("renderiza sem placeholders não resolvidos", () => {
    expect(html).not.toMatch(/\{\{/);
  });

  it("usa a destinação comercial e a cláusula de ação renovatória", () => {
    expect(html).toContain("comércio varejista de vestuário");
    expect(html).toContain("AÇÃO RENOVATÓRIA");
    expect(html).toContain("art. 56");
  });

  it("regressão: ramo de fiador continua funcionando", () => {
    expect(html).toContain("FIADOR(A)");
    expect(html).toContain("Fulano Fiador");
    expect(html).toContain("benefício de ordem");
  });
});

describe("enrich locação: tipo do imóvel e foro (correções QA 2026-06-06)", () => {
  const base = dadosLocacaoSchema.parse({
    locadores: [{ tipo_pessoa: "fisica", nome: "Loc", cpf: "12345678901" }],
    locatarios: [{ tipo_pessoa: "fisica", nome: "Lct", cpf: "98765432100" }],
    imovel: {
      kind: "comercial_sala",
      rua: "Rua Augusta",
      numero: "1200",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01304001",
      descricao: "Loja com vitrine.",
    },
    aluguel: {
      valor: 8000,
      dia_vencimento: 5,
      indice_reajuste: "IPCA",
      vigencia_inicio: "2026-08-01",
      vigencia_meses: 60,
      meio_pagamento: "boleto",
    },
    garantia: { tipo: "seguro_fianca" },
    assinatura: { cidade: "São Paulo", uf: "SP", data: "2026-06-06" },
    foro: "São Paulo",
  });

  it("mapeia kind do enum para rótulo legível (comercial_sala → sala comercial)", () => {
    const enriched = enrichLocacaoData(base as Record<string, unknown>);
    const imovel = enriched.imovel as Record<string, unknown>;
    expect(imovel.tipo_texto).toBe("sala comercial");
  });

  it("propaga o foro eleito para config.foro_texto", () => {
    const enriched = enrichLocacaoData(base as Record<string, unknown>);
    const config = enriched.config as Record<string, unknown>;
    expect(config.foro_texto).toBe("São Paulo");
  });

  it("renderiza o tipo legível e o foro eleito no contrato (não o slug nem o fallback)", () => {
    const html = renderContratoHTML(loadTemplate(), enrichLocacaoData(base as Record<string, unknown>));
    expect(html).toContain("proprietária do(a) sala comercial");
    expect(html).not.toContain("comercial_sala");
    expect(html).toContain("comarca de São Paulo");
    expect(html).not.toContain("comarca de localização do imóvel");
  });
});

// ============================================================================
// Padrão contratual da ORG (contractDefaultsJson.locacao) sobre o hard-coded.
// ============================================================================
describe("enrichLocacaoData — padrão da org × padrão de fábrica", () => {
  const vazio = () => ({}) as Record<string, unknown>;

  it("sem ctx, mantém os números que o módulo sempre praticou", () => {
    const config = enrichLocacaoData(vazio()).config as Record<string, unknown>;
    expect(config.multa_atraso_percent).toBe(10);
    expect(config.juros_mensais_atraso).toBe(1);
    expect(config.multa_rescisoria_meses).toBe(3);
    // Honorários advocatícios viraram configuração (D3) — fallback 10%.
    expect(config.honorarios_advocaticios_percent).toBe(10);
  });

  it("honorários advocatícios: org sobrepõe fábrica, negócio sobrepõe org", () => {
    const org = {
      foro: "",
      assinatura: { cidade: "", uf: "", data: "" },
      config: {
        multa_atraso_percent: 10,
        juros_mensais_atraso: 1,
        multa_rescisoria_meses: 3,
        honorarios_advocaticios_percent: 20,
      },
    };
    expect(
      (enrichLocacaoData(vazio(), { contractDefaults: org }).config as Record<
        string,
        unknown
      >).honorarios_advocaticios_percent
    ).toBe(20);
    expect(
      (
        enrichLocacaoData(
          { config: { honorarios_advocaticios_percent: 15 } },
          { contractDefaults: org }
        ).config as Record<string, unknown>
      ).honorarios_advocaticios_percent
    ).toBe(15);
  });

  it("padrão da org sobrepõe o de fábrica", () => {
    const config = enrichLocacaoData(vazio(), {
      contractDefaults: {
        foro: "Santos/SP",
        assinatura: { cidade: "Santos", uf: "SP", data: "" },
        config: {
          multa_atraso_percent: 2,
          juros_mensais_atraso: 0.5,
          multa_rescisoria_meses: 1,
          honorarios_advocaticios_percent: 20,
        },
      },
    });
    const cfg = config.config as Record<string, unknown>;
    expect(cfg.multa_atraso_percent).toBe(2);
    expect(cfg.juros_mensais_atraso).toBe(0.5);
    expect(cfg.multa_rescisoria_meses).toBe(1);
    // Comarca da org vira o foro e a ponte que o template imprime.
    expect(config.foro).toBe("Santos/SP");
    expect(cfg.foro_texto).toBe("Santos/SP");
    // Cidade da org materializa o município do fecho.
    expect(cfg.municipio_imovel).toBe("Santos/SP");
  });

  it("o dado do negócio VENCE o padrão da org (enrich é aditivo)", () => {
    const out = enrichLocacaoData(
      { foro: "Campinas/SP", config: { multa_atraso_percent: 20 } },
      {
        contractDefaults: {
          foro: "Santos/SP",
          assinatura: { cidade: "", uf: "", data: "" },
          config: {
            multa_atraso_percent: 2,
            juros_mensais_atraso: 1,
            multa_rescisoria_meses: 3,
            honorarios_advocaticios_percent: 10,
          },
        },
      }
    );
    const cfg = out.config as Record<string, unknown>;
    expect(out.foro).toBe("Campinas/SP");
    expect(cfg.foro_texto).toBe("Campinas/SP");
    expect(cfg.multa_atraso_percent).toBe(20);
  });

  it("padrão da org vazio não inventa assinatura nem foro", () => {
    const out = enrichLocacaoData(vazio(), {
      contractDefaults: {
        foro: "",
        assinatura: { cidade: "", uf: "", data: "" },
        config: {
          multa_atraso_percent: 10,
          juros_mensais_atraso: 1,
          multa_rescisoria_meses: 3,
          honorarios_advocaticios_percent: 10,
        },
      },
    });
    expect(out.foro).toBeUndefined();
    expect(out.assinatura).toBeUndefined();
    expect((out.config as Record<string, unknown>).foro_texto).toBeUndefined();
  });
});

describe("enrichLocacaoData — seguro-fiança: tomador e vigência (D4)", () => {
  const cfg = (data: Record<string, unknown>) =>
    enrichLocacaoData(data).config as Record<string, unknown>;

  it("deriva os textos do tomador da apólice", () => {
    expect(
      cfg({ garantia: { tipo: "seguro_fianca", seguro_tomador: "inquilino" } })
        .seguro_tomador_texto
    ).toBe("o LOCATÁRIO");
    expect(
      cfg({ garantia: { tipo: "seguro_fianca", seguro_tomador: "proprietario" } })
        .seguro_tomador_texto
    ).toBe("o LOCADOR");
  });

  it("deriva os textos da vigência da apólice", () => {
    expect(
      cfg({ garantia: { tipo: "seguro_fianca", seguro_vigencia: "anual_renovavel" } })
        .seguro_vigencia_texto
    ).toBe("com renovação anual obrigatória enquanto durar a locação");
    expect(
      cfg({
        garantia: { tipo: "garantia_onerosa", seguro_vigencia: "prazo_contrato" },
      }).seguro_vigencia_texto
    ).toBe("pelo prazo integral da locação");
  });

  it("sem escolha (ou valor desconhecido) não materializa texto nenhum", () => {
    const semEscolha = cfg({ garantia: { tipo: "seguro_fianca" } });
    expect(semEscolha.seguro_tomador_texto).toBeUndefined();
    expect(semEscolha.seguro_vigencia_texto).toBeUndefined();
    expect(cfg({}).seguro_tomador_texto).toBeUndefined();
    expect(
      cfg({ garantia: { seguro_tomador: "terceiro" } }).seguro_tomador_texto
    ).toBeUndefined();
  });

  it("é idempotente: texto já gravado no dataJson vence", () => {
    expect(
      cfg({
        garantia: { tipo: "seguro_fianca", seguro_tomador: "inquilino" },
        config: { seguro_tomador_texto: "a IMOBILIÁRIA" },
      }).seguro_tomador_texto
    ).toBe("a IMOBILIÁRIA");
  });
});

describe("enrichLocacaoData — rename garantia_digital → garantia_onerosa", () => {
  it("REGRESSÃO: dataJson legado chega ao template com o tipo canônico", () => {
    // O contrato decide a cláusula por `(eq garantia.tipo "…")`. Sem esta
    // canonicalização, um Contract.dataJson congelado antes do rename (que a
    // migration NÃO toca, por ser snapshot) cairia no `{{else}}` genérico.
    const out = enrichLocacaoData({
      garantia: { tipo: "garantia_digital", provider: "Almada" },
    });
    const garantia = out.garantia as Record<string, unknown>;
    expect(garantia.tipo).toBe("garantia_onerosa");
    expect(garantia.provider).toBe("Almada");
  });

  it("não inventa nem apaga: valor canônico e desconhecido passam intactos", () => {
    expect(
      (enrichLocacaoData({ garantia: { tipo: "garantia_onerosa" } })
        .garantia as Record<string, unknown>).tipo
    ).toBe("garantia_onerosa");
    expect(
      (enrichLocacaoData({ garantia: { tipo: "aval_bancario" } })
        .garantia as Record<string, unknown>).tipo
    ).toBe("aval_bancario");
    expect(enrichLocacaoData({}).garantia).toBeUndefined();
  });
});

describe("template v3 — administração e despesas decididas no form (2026-08)", () => {
  const ADMINISTRADORA = {
    nome: "Imobiliária Exemplo Ltda",
    creci: "24.342-J/SP",
    endereco: "Rua Roque Petrella, 188, São Paulo/SP",
  };

  it("adm=sim com paga_e_retem troca a 9.1.2 e omite a 9.1.3 de boleto a vencer", () => {
    const data = dadosLocacaoSchema.parse({
      ...sample,
      aluguel: {
        ...(sample.aluguel as Record<string, unknown>),
        adm_imobiliaria: true,
        encargos_repasse: "paga_e_retem",
        taxa_admin_percent: 8,
      },
    });
    const html = renderContratoHTML(
      loadTemplate(),
      enrichLocacaoData(data as Record<string, unknown>, { administradora: ADMINISTRADORA })
    );
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain("deduzidos dos repasses mensais devidos à PARTE LOCADORA");
    expect(html).not.toContain("no mesmo boleto");
    expect(html).not.toContain("pagos a vencer");
  });

  it("adm=não explícito vence a org: administradora não é nomeada", () => {
    const data = dadosLocacaoSchema.parse({
      ...sample,
      aluguel: {
        ...(sample.aluguel as Record<string, unknown>),
        adm_imobiliaria: false,
      },
    });
    const html = renderContratoHTML(
      loadTemplate(),
      enrichLocacaoData(data as Record<string, unknown>, { administradora: ADMINISTRADORA })
    );
    expect(html).toContain("diretamente à PARTE LOCADORA ou a quem esta indicar");
    expect(html).not.toContain("Imobiliária Exemplo Ltda");
  });

  it("clausula_rescisoria=false troca a cláusula 7 inteira: sem multa pré-fixada", () => {
    const data = dadosLocacaoSchema.parse({
      ...sample,
      config: { clausula_rescisoria: false },
    });
    const html = renderContratoHTML(
      loadTemplate(),
      enrichLocacaoData(data as Record<string, unknown>)
    );
    // Nenhuma multa estipulada em aluguéis — nem a 7.1 antiga nem a 7.2.
    expect(html).not.toContain("Fica estipulada a multa equivalente");
    expect(html).not.toContain("na oportunidade da infração");
    // A âncora "item 7.1" referenciada por 5.4/6.7 continua existindo,
    // como perdas e danos + convenção expressa de ausência de multa.
    expect(html).toContain("não haverá multa pré-fixada por rescisão antecipada");
    expect(html).toContain("perdas e danos");
  });

  it("taxa de administração 0% explícita é respeitada (não vira 10%)", () => {
    const data = dadosLocacaoSchema.parse({
      ...sample,
      aluguel: {
        ...(sample.aluguel as Record<string, unknown>),
        adm_imobiliaria: true,
        encargos_repasse: "repasse_integral",
        taxa_admin_percent: 0,
      },
    });
    const enriched = enrichLocacaoData(data as Record<string, unknown>, {
      administradora: ADMINISTRADORA,
    });
    expect((enriched.config as Record<string, unknown>).taxa_admin_percent).toBe(0);
  });

  it("default (sem escolha) mantém a 7.2 — comportamento histórico", () => {
    const html = renderContratoHTML(
      loadTemplate(),
      enrichLocacaoData(sample as Record<string, unknown>)
    );
    expect(html).toContain("rescisão antecipada");
  });

  it("contas de consumo no boleto do condomínio trocam a 9.3 e listam as contas", () => {
    const data = dadosLocacaoSchema.parse({
      ...sample,
      aluguel: {
        ...(sample.aluguel as Record<string, unknown>),
        contas_consumo_individualizadas: false,
        contas_no_condominio: ["agua", "gas"],
      },
    });
    const html = renderContratoHTML(
      loadTemplate(),
      enrichLocacaoData(data as Record<string, unknown>)
    );
    expect(html).toContain("integram o rateio de despesas do condomínio");
    expect(html).toContain("água e gás");
    expect(html).not.toContain("transferência para seu nome das contas de consumo de energia");
  });
});
