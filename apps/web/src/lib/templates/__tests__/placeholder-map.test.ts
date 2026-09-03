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

  it("encargos: IPTU e condomínio vêm do form em BRL; zero e ausente ficam vazios", () => {
    // Fixture base não informa os itens → vazio.
    expect(map.iptu_valor).toBe("");
    expect(map.condominio_valor).toBe("");

    const build = (aluguel: Record<string, unknown>) =>
      buildLocacaoPlaceholderMap(
        enrichLocacaoData(
          JSON.parse(JSON.stringify({ ...locacaoBase, aluguel: { ...locacaoBase.aluguel, ...aluguel } })),
          { administradora: { nome: "ImobPro Ltda", creci: "24.342-J/SP", endereco: "Rua X, 1" } }
        )
      );
    const comEncargos = build({ iptu_mensal: 31.67, condominio_mensal: 676.08 });
    expect(comEncargos.iptu_valor).toMatch(/R\$\s?31,67/);
    expect(comEncargos.condominio_valor).toMatch(/R\$\s?676,08/);

    // O form grava 0 quando o campo fica em branco (casa sem condomínio):
    // "R$ 0,00" numa cláusula de encargos seria afirmação falsa.
    const zerado = build({ iptu_mensal: 0, condominio_mensal: 0 });
    expect(zerado.iptu_valor).toBe("");
    expect(zerado.condominio_valor).toBe("");
    // Valor que não é número (ditado por voz) também não vira "R$ NaN".
    expect(build({ condominio_mensal: "31,67" }).condominio_valor).toBe("");
  });

  it("imovel_identificacao: tipo + unidade + condomínio, como a 1.1 do canônico", () => {
    // Fixture: apartamento, complemento "apto. 121" (o form repete o tipo no
    // complemento — a composição não pode sair "apartamento apto. 121").
    expect(map.imovel_identificacao).toBe("apartamento 121");

    const comCondominio = buildLocacaoPlaceholderMap(
      enrichLocacaoData(
        JSON.parse(
          JSON.stringify({
            ...locacaoBase,
            imovel: { ...locacaoBase.imovel, complemento: "33", condominio_nome: "condomínio edifício Siracusa" },
          })
        ),
        {}
      )
    );
    expect(comCondominio.imovel_identificacao).toBe("apartamento 33, do condomínio edifício Siracusa");

    const casa = buildLocacaoPlaceholderMap(
      enrichLocacaoData(
        JSON.parse(JSON.stringify({ ...locacaoBase, imovel: { ...locacaoBase.imovel, kind: "casa", complemento: "" } })),
        {}
      )
    );
    expect(casa.imovel_identificacao).toBe("casa");

    // Sinônimo colado ("apto.121") também cai; sinônimo de OUTRO tipo fica
    // (prédio misto: loja dentro de apartamento não é redundância).
    const build = (imovel: Record<string, unknown>) =>
      buildLocacaoPlaceholderMap(
        enrichLocacaoData(JSON.parse(JSON.stringify({ ...locacaoBase, imovel: { ...locacaoBase.imovel, ...imovel } })), {})
      );
    expect(build({ complemento: "apto.121" }).imovel_identificacao).toBe("apartamento 121");
    expect(build({ complemento: "Loja 1" }).imovel_identificacao).toBe("apartamento Loja 1");
    expect(build({ kind: "casa", complemento: "Casa 2" }).imovel_identificacao).toBe("casa 2");
    // Sinônimo como PREFIXO DE PALAVRA não é sinônimo: "Apenas fundos" fica inteiro.
    expect(build({ complemento: "Apenas fundos" }).imovel_identificacao).toBe("apartamento Apenas fundos");
    expect(build({ kind: "casa", complemento: "Casarão dos fundos" }).imovel_identificacao).toBe("casa Casarão dos fundos");
    // Sinônimo curto vs longo: `conj` não pode sequestrar "Conjunto".
    expect(build({ kind: "comercial_sala", complemento: "Conjunto 5" }).imovel_identificacao).toBe("sala comercial 5");
    expect(build({ kind: "comercial_sala", complemento: "Sala comercial 5" }).imovel_identificacao).toBe("sala comercial 5");
    // Condomínio só com espaço não vira ", do ".
    expect(build({ complemento: "", condominio_nome: "  " }).imovel_identificacao).toBe("apartamento");
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
  it.each(["administracao_locacao", "locacao", "locacao_comercial", "temporada"])(
    "todo token do catálogo %s existe em buildLocacaoPlaceholderMap",
    (modalidade) => {
      // Clone: enrichLocacaoData muta o imóvel (tipo_texto) e o fixture é compartilhado.
      const enriched = enrichLocacaoData(JSON.parse(JSON.stringify(locacaoBase)), {});
      const map = buildLocacaoPlaceholderMap(enriched);
      const mapKeys = Object.keys(map);
      // `contrato_numero` é injetado na geração (contract-generation.ts), não no mapa.
      const tokens = catalogForModalidade(modalidade)
        .map((d) => d.token)
        .filter((t) => t !== "contrato_numero");
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(mapKeys).toContain(token);
      }
    }
  );

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

/**
 * Corretagem: a chave existe no mapa mesmo vazia, porque token ausente do mapa
 * é APAGADO do Doc por `cleanupOrphanPlaceholders` — o modelo perderia o
 * parágrafo inteiro em vez de deixá-lo em branco.
 */
describe("buildLocacaoPlaceholderMap — corretagem", () => {
  const comCorretor = () => ({
    ...JSON.parse(JSON.stringify(locacaoBase)),
    comissao: {
      angariadores: [
        {
          nome: "Ana Ribeiro",
          tipo_pessoa: "fisica",
          cpf: "52998224725",
          creci: "12.345-F",
          recebimento: { pix_chave: "52998224725", pix_tipo_chave: "CPF" },
        },
      ],
    },
  });

  it("emite as duas chaves mesmo quando o negócio não tem corretor", () => {
    const map = buildLocacaoPlaceholderMap(
      enrichLocacaoData(JSON.parse(JSON.stringify(locacaoBase)))
    );
    expect(map).toHaveProperty("corretagem_qualificacao", "");
    expect(map).toHaveProperty("corretagem_dados_pagamento", "");
  });

  it("qualifica o corretor a partir do formulário", () => {
    const map = buildLocacaoPlaceholderMap(enrichLocacaoData(comCorretor()));
    expect(map.corretagem_qualificacao).toBe(
      "Ana Ribeiro, inscrito(a) no CPF/MF sob nº 529.982.247-25, CRECI nº 12.345-F"
    );
  });

  it("o rateio do 1º aluguel sai do mapa com valores e nomes, mas sem via de pagamento", async () => {
    const { stripCommissionerReceiving } = await import("@/lib/forms/redact-datajson");
    const dados = comCorretor() as Record<string, unknown>;
    const comissao = dados.comissao as Record<string, unknown>;
    comissao.forma_taxa_locacao = "valor_fixo";
    comissao.taxa_locacao_valor = 3000;
    (comissao.angariadores as Record<string, unknown>[])[0].valor_primeiro_aluguel = 1000;

    const map = buildLocacaoPlaceholderMap(
      enrichLocacaoData(stripCommissionerReceiving(dados))
    );
    // `moeda` emite NBSP depois de "R$" (padrão pt-BR do Intl).
    const rateio = map.rateio_primeiro_aluguel.replace(/\u00a0/g, " ");
    // Diferente de `corretagem_dados_pagamento`, a lista NÃO sai vazia: valor e
    // beneficiário já são afirmações verdadeiras sem o dado bancário. A via é o
    // único pedaço que o call site acrescenta.
    expect(rateio).toContain("R$ 2.000,00");
    expect(rateio).toContain("R$ 1.000,00");
    expect(rateio).toContain("Ana Ribeiro");
    expect(rateio).not.toContain("por meio");
  });

  it("o caminho do mapa NUNCA produz repasse: o bancário sai antes do enrich", async () => {
    const { stripCommissionerReceiving } = await import("@/lib/forms/redact-datajson");
    // Controle que sabe falhar: com o dado bruto, a chave sairia preenchida.
    expect(
      buildLocacaoPlaceholderMap(enrichLocacaoData(comCorretor())).corretagem_dados_pagamento
    ).not.toBe("");
    // Como o pipeline de verdade faz. O valor real é injetado pelo call site.
    const semBanco = stripCommissionerReceiving(comCorretor());
    const map = buildLocacaoPlaceholderMap(enrichLocacaoData(semBanco));
    expect(map.corretagem_dados_pagamento).toBe("");
    expect(map.corretagem_qualificacao).toContain("Ana Ribeiro");
  });
});
