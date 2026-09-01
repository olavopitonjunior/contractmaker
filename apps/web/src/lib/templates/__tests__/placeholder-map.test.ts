import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Render real (setup.ts mocka renderContratoHTML globalmente).
vi.unmock("@/lib/render/handlebars");

import {
  buildLocacaoPlaceholderMap,
  buildVendaPlaceholderMap,
} from "../placeholder-map";
import { catalogForModalidade } from "../placeholder-catalog";
import {
  clausulaGarantia,
  qualificacaoPessoas,
  htmlToPlainText,
  CONJUGE_SUFFIX_HBS,
} from "../composed-blocks";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { enrichLocacaoData } from "@/lib/locacao/enrich";

const locacaoBase = {
  locadores: [
    {
      tipo_pessoa: "fisica",
      nome: "Helena Castro Vilaboim",
      nacionalidade: "brasileira",
      estado_civil: "viúva",
      profissao: "engenheira",
      rg: "11.222.333-4",
      cpf: "11144477735",
      email: "helena@example.com",
      endereco: "Rua das Acácias",
      numero: "100",
      complemento: "apto. 502",
      bairro: "Vila Mariana",
      cidade: "São Paulo",
      uf: "SP",
      cep: "04101000",
    },
    {
      tipo_pessoa: "juridica",
      razao_social: "Patrimonial Castro Ltda",
      cnpj: "12345678000190",
      endereco: "Rua dos Pinheiros",
      numero: "200",
      cidade: "São Paulo",
      uf: "SP",
      representante: { nome: "Ana Ribeiro", cpf: "45678901233" },
    },
  ],
  locatarios: [
    { tipo_pessoa: "fisica", nome: "Bruno Tavares", cpf: "52998224725" },
  ],
  imovel: {
    kind: "apartamento",
    rua: "Avenida Brigadeiro Faria Lima",
    numero: "3500",
    complemento: "apto. 121",
    bairro: "Itaim Bibi",
    cidade: "São Paulo",
    uf: "SP",
    cep: "04538132",
    matricula: "152.834",
    cartorio: "5º RI de São Paulo/SP",
    descricao: "Apartamento de 3 dormitórios.",
  },
  aluguel: {
    valor: 3500,
    dia_vencimento: 10,
    indice_reajuste: "IGPM",
    vigencia_inicio: "2026-07-01",
    vigencia_meses: 30,
    meio_pagamento: "boleto",
  },
  garantia: {
    tipo: "titulo_capitalizacao",
    provider: "Porto Seguro Capitalização S.A.",
    titulo_valor: 10500,
    titulo_proposta: "1234567-001",
  },
  assinatura: { cidade: "São Paulo", uf: "SP", data: "2026-06-09" },
};

describe("buildLocacaoPlaceholderMap", () => {
  const enriched = enrichLocacaoData(
    JSON.parse(JSON.stringify(locacaoBase)),
    { administradora: { nome: "ImobPro Ltda", creci: "24.342-J/SP", endereco: "Rua X, 1" } }
  );
  const map = buildLocacaoPlaceholderMap(enriched);

  it("compostos: qualificações narrativas com PF e PJ", () => {
    expect(map.locadores_qualificacao).toContain(
      "Helena Castro Vilaboim, brasileira, viúva, engenheira, portador(a) da cédula de identidade RG nº 11.222.333-4, inscrito(a) no CPF/MF sob nº 111.444.777-35"
    );
    expect(map.locadores_qualificacao).toContain(
      "Patrimonial Castro Ltda, pessoa jurídica de direito privado, inscrita no CNPJ/MF sob nº 12.345.678/0001-90"
    );
    expect(map.locadores_qualificacao).toContain("; "); // separador entre partes
    expect(map.locatarios_qualificacao).toContain("Bruno Tavares");
  });

  it("compostos: cláusula de garantia capitalização 8.1–8.6 multi-parágrafo", () => {
    expect(map.clausula_garantia).toContain("8.1. Para garantir as obrigações");
    expect(map.clausula_garantia).toContain("proposta/formulário n.º 1234567-001");
    expect(map.clausula_garantia).toContain("REAPLICAR");
    expect(map.clausula_garantia).toContain("8.6.");
    expect(map.clausula_garantia.split("\n").length).toBeGreaterThan(4);
  });

  it("compostos: administradora nomeada e assinaturas", () => {
    expect(map.bloco_administradora).toContain("ImobPro Ltda");
    expect(map.bloco_administradora).toContain("CRECI sob nº 24.342-J/SP");
    expect(map.assinaturas).toContain("PARTE LOCATÁRIA");
    expect(map.assinaturas).toContain("Testemunha");
  });

  it("simples formatados", () => {
    expect(map.aluguel_valor).toMatch(/R\$\s?3\.500,00/);
    expect(map.aluguel_valor_extenso).toBe("três mil e quinhentos reais");
    expect(map.vigencia_meses).toBe("30 (trinta)");
    expect(map.multa_atraso_percent).toBe("10% (dez por cento)");
    expect(map.indice_reajuste_texto).toBe("Índice Geral de Preços - Mercado (IGP-M)");
    expect(map.imovel_endereco_completo).toContain("Avenida Brigadeiro Faria Lima, nº 3500");
    expect(map.imovel_endereco_completo).toContain("CEP 04538-132");
    expect(map.imovel_matricula).toBe("152.834 do 5º RI de São Paulo/SP");
    expect(map.data_local_assinatura).toContain("São Paulo/SP, 9 de junho de 2026");
  });

  it("encargos da 9.1.2: IPTU e condomínio vêm do form em BRL; vazios quando não informados", () => {
    // Fixture base não informa os itens → chaves existem e ficam vazias (casa
    // sem condomínio, ou form antigo): nada do imóvel-fonte sobra no contrato.
    expect(map.iptu_valor).toBe("");
    expect(map.condominio_valor).toBe("");

    const comEncargos = buildLocacaoPlaceholderMap(
      enrichLocacaoData(
        JSON.parse(
          JSON.stringify({
            ...locacaoBase,
            aluguel: { ...locacaoBase.aluguel, iptu_mensal: 31.67, condominio_mensal: 676.08 },
          })
        ),
        { administradora: { nome: "ImobPro Ltda", creci: "24.342-J/SP", endereco: "Rua X, 1" } }
      )
    );
    expect(comEncargos.iptu_valor).toMatch(/R\$\s?31,67/);
    expect(comEncargos.condominio_valor).toMatch(/R\$\s?676,08/);
  });

  it("sem administradora cai no fallback e fiador vazio fora da fiança", () => {
    const semAdm = buildLocacaoPlaceholderMap(
      enrichLocacaoData(JSON.parse(JSON.stringify(locacaoBase)))
    );
    expect(semAdm.bloco_administradora).toContain("diretamente à PARTE LOCADORA");
    expect(semAdm.fiador_qualificacao).toBe("");
  });

  it("garantia fiador: qualificação + cláusula com benefício de ordem", () => {
    const comFiador = enrichLocacaoData(
      JSON.parse(
        JSON.stringify({
          ...locacaoBase,
          garantia: {
            tipo: "fiador",
            fiador: { tipo_pessoa: "fisica", nome: "Carlos Fiador", cpf: "11144477735" },
          },
        })
      )
    );
    const m = buildLocacaoPlaceholderMap(comFiador);
    expect(m.fiador_qualificacao).toContain("Carlos Fiador");
    expect(m.clausula_garantia).toContain("benefício de ordem");
    expect(m.assinaturas).toContain("FIADOR(A)");
  });
});

describe("paridade blocos compostos × locacao_residencial_v3.hbs", () => {
  function loadTemplate(): string {
    const candidates = [
      path.join(process.cwd(), "..", "..", "templates", "locacao_residencial_v3.hbs"),
      path.join(process.cwd(), "templates", "locacao_residencial_v3.hbs"),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c, "utf-8");
    throw new Error("locacao_residencial_v3.hbs não encontrado");
  }

  it("clausulaGarantia e qualificacaoPessoas são substrings do contrato renderizado", () => {
    const enriched = enrichLocacaoData(JSON.parse(JSON.stringify(locacaoBase)));
    const htmlPlano = htmlToPlainText(
      renderContratoHTML(loadTemplate(), enriched)
    );
    const garantia = clausulaGarantia(enriched);
    for (const par of garantia.split("\n").filter(Boolean)) {
      expect(htmlPlano).toContain(par);
    }
    const qual = qualificacaoPessoas(enriched.locadores as unknown[]);
    expect(htmlPlano).toContain(qual.split("; ")[0]);
  });

  // O fixture acima tem locadora viúva e garantia por título, então o sufixo de
  // outorga resolve vazio dos dois lados e a asserção de substring passaria sem
  // exercitar nada dele. Este caso força uma parte casada.
  // Trava a paridade na FONTE, não só no render: uma edição manual num .hbs
  // que reordene as condições pode manter o render igual em alguns casos e
  // deixar o teste de substring verde.
  it.each([
    "locacao_residencial_v3.hbs",
    "locacao_comercial_v3.hbs",
    "administracao_locacao_v1.hbs",
  ])("%s contém o fragmento de outorga literal de composed-blocks", (file) => {
    const candidates = [
      path.join(process.cwd(), "..", "..", "templates", file),
      path.join(process.cwd(), "templates", file),
    ];
    const tpl = candidates.find((c) => fs.existsSync(c));
    expect(tpl, `${file} não encontrado`).toBeDefined();
    expect(fs.readFileSync(tpl!, "utf-8")).toContain(CONJUGE_SUFFIX_HBS);
  });

  it("outorga do cônjuge: composed-blocks e o .hbs produzem o MESMO texto", () => {
    const comConjuge = {
      ...JSON.parse(JSON.stringify(locacaoBase)),
      locadores: [
        {
          tipo_pessoa: "fisica",
          nome: "Helena Castro Vilaboim",
          nacionalidade: "brasileira",
          estado_civil: "Casado(a)",
          profissao: "engenheira",
          cpf: "11144477735",
          email: "helena@example.com",
          conjuge: { nome: "Ricardo Vilaboim", cpf: "52998224725" },
        },
      ],
    };
    const enriched = enrichLocacaoData(comConjuge);
    const htmlPlano = htmlToPlainText(renderContratoHTML(loadTemplate(), enriched));
    const qual = qualificacaoPessoas(enriched.locadores as unknown[]);

    expect(qual).toContain("casado(a) com Ricardo Vilaboim");
    // A paridade real: o fragmento montado em composed-blocks tem que aparecer
    // literalmente no contrato renderizado a partir do .hbs.
    expect(htmlPlano).toContain(qual.split("; ")[0]);
  });

  it("ex-cônjuge deixado no dataJson não é qualificado", () => {
    const divorciado = {
      ...JSON.parse(JSON.stringify(locacaoBase)),
      locadores: [
        {
          tipo_pessoa: "fisica",
          nome: "Helena Castro Vilaboim",
          estado_civil: "Divorciado(a)",
          cpf: "11144477735",
          // Trocar o estado civil no form esconde o bloco, mas não apaga isto.
          conjuge: { nome: "Ricardo Vilaboim", cpf: "52998224725" },
        },
      ],
    };
    const enriched = enrichLocacaoData(divorciado);
    const htmlPlano = htmlToPlainText(renderContratoHTML(loadTemplate(), enriched));

    expect(qualificacaoPessoas(enriched.locadores as unknown[])).not.toContain(
      "Ricardo Vilaboim"
    );
    expect(htmlPlano).not.toContain("Ricardo Vilaboim");
  });
});

describe("buildVendaPlaceholderMap", () => {
  const venda = {
    vendedores: [
      {
        tipo_pessoa: "fisica",
        nome: "João Silva",
        nacionalidade: "Brasileiro",
        cpf: "11144477735",
        conjuge: { nome: "Maria Silva", cpf: "52998224725" },
      },
    ],
    compradores: [{ tipo_pessoa: "fisica", nome: "Carlos Almeida", cpf: "52998224725" }],
    imoveis: [
      {
        rua: "Rua A",
        numero: "10",
        bairro: "Centro",
        cidade: "São Paulo",
        uf: "SP",
        cep: "01000000",
        matricula: "111",
        descricao: "Casa térrea.",
      },
    ],
    pagamento: {
      valor_total: 1250000,
      sinal_arras: 125000,
      parcelas: [
        { letra: "a", valor: 500000, tipo_texto: "Recursos próprios", momento_texto: "em até 30 dias" },
        { letra: "b", valor: 625000, tipo_texto: "Recursos próprios" },
      ],
    },
    comissao: { valor: 75000 },
    config: {},
  };
  const map = buildVendaPlaceholderMap(venda as Record<string, unknown>);

  it("qualificações com cônjuge e parcelas multi-linha", () => {
    expect(map.vendedores_qualificacao).toContain("João Silva");
    expect(map.vendedores_qualificacao).toContain("casado(a) com Maria Silva");
    expect(map.compradores_qualificacao).toContain("Carlos Almeida");
    expect(map.parcelas_pagamento).toContain("a)");
    expect(map.parcelas_pagamento).toContain("b)");
    expect(map.parcelas_pagamento).toContain("Recursos próprios");
    expect(map.parcelas_pagamento.split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("simples formatados de venda", () => {
    expect(map.preco_total).toMatch(/R\$\s?1\.250\.000,00/);
    expect(map.preco_total_extenso).toContain("um milhão");
    expect(map.sinal_valor).toMatch(/R\$\s?125\.000,00/);
    expect(map.comissao_valor).toMatch(/R\$\s?75\.000,00/);
    expect(map.imovel_endereco_completo).toContain("Rua A, nº 10");
  });
});

describe("administração de locação — engine google_docs", () => {
  // Invariante crítica: o contrato de administração reusa buildLocacaoPlaceholderMap
  // (o deal de adm é um deal de locação). Se um token do catálogo de adm NÃO
  // existir no mapa, o replacePlaceholdersInDoc não o substitui e o
  // cleanupOrphanPlaceholders APAGA o {{token}} → campo em branco no contrato.
  it("todo token do catálogo administracao_locacao existe em buildLocacaoPlaceholderMap", () => {
    const enriched = enrichLocacaoData(locacaoBase as Record<string, unknown>, {});
    const map = buildLocacaoPlaceholderMap(enriched);
    const mapKeys = Object.keys(map);
    const admTokens = catalogForModalidade("administracao_locacao").map((d) => d.token);
    expect(admTokens.length).toBeGreaterThan(0);
    for (const token of admTokens) {
      expect(mapKeys).toContain(token);
    }
  });

  // O conjunto de adm é intencionalmente mínimo: só CONTRATANTE (proprietário),
  // imóvel e data. Administradora/foro/assinaturas ficam LITERAIS no modelo da
  // imobiliária — `assinaturas` (blocoAssinaturas) montaria locador+locatário,
  // errado pro adm; `foro_texto`/`bloco_administradora` virariam texto genérico.
  it("expõe só os tokens seguros e mantém administradora/foro/assinaturas literais", () => {
    const admTokens = catalogForModalidade("administracao_locacao").map((d) => d.token);
    expect(admTokens).toEqual(
      expect.arrayContaining([
        "locadores_qualificacao",
        "imovel_endereco_completo",
        "data_local_assinatura",
      ])
    );
    expect(admTokens).not.toContain("assinaturas");
    expect(admTokens).not.toContain("foro_texto");
    expect(admTokens).not.toContain("bloco_administradora");
    expect(admTokens).not.toContain("locatarios_qualificacao");
  });
});
