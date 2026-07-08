// ============================================================================
// Catálogo canônico de placeholders pra templates engine="google_docs" (o
// modelo da imobiliária é um Google Doc com {{tokens}} flat; loops e
// condicionais são resolvidos SERVER-SIDE pelos blocos compostos em
// composed-blocks.ts). Fonte única para: prompt do pass de IA (inserção de
// placeholders no DOCX), validação da página de revisão e documentação na UI.
// Aditivo: nunca remova/renomeie tokens publicados — docs de tenants dependem.
// ============================================================================

export type PlaceholderKind = "simple" | "composed";

export type PlaceholderModalidade =
  | "locacao"
  | "locacao_comercial"
  | "a_vista"
  | "financiamento"
  | "administracao_locacao";

export interface PlaceholderDef {
  token: string;
  label: string;
  description: string;
  example: string;
  required: boolean;
  kind: PlaceholderKind;
  modalidades: PlaceholderModalidade[];
}

const LOCACAO: PlaceholderModalidade[] = ["locacao", "locacao_comercial"];
const VENDA: PlaceholderModalidade[] = ["a_vista", "financiamento"];
const TODAS: PlaceholderModalidade[] = [...LOCACAO, ...VENDA];
// Contrato de administração (imobiliária ↔ proprietário). Conjunto MÍNIMO e
// seguro de tokens: só os que existem em buildLocacaoPlaceholderMap (senão o
// cleanupOrphanPlaceholders apaga o token e o campo sai em branco). O restante
// do modelo — administradora, taxa, repasse, foro, assinaturas — fica LITERAL
// no doc da imobiliária (já vem baked no modelo).
const ADMINISTRACAO: PlaceholderModalidade[] = ["administracao_locacao"];

export const PLACEHOLDER_CATALOG: PlaceholderDef[] = [
  // ——— Compostos (server-side resolve loops/condicionais) ———
  {
    token: "locadores_qualificacao",
    label: "Qualificação do(s) locador(es)",
    description:
      "Qualificação narrativa completa de todos os locadores (PF/PJ): nome, nacionalidade, estado civil, profissão, RG, CPF/CNPJ, endereço, e-mail. No contrato de administração, corresponde ao(à) CONTRATANTE / PARTE PROPRIETÁRIA.",
    example:
      "Helena Castro, brasileira, viúva, engenheira, portador(a) da cédula de identidade RG nº 11.222.333-4, inscrito(a) no CPF/MF sob nº 111.444.777-35, residente e domiciliado(a) na Rua das Acácias, nº 100…",
    required: true,
    kind: "composed",
    modalidades: [...LOCACAO, ...ADMINISTRACAO],
  },
  {
    token: "locatarios_qualificacao",
    label: "Qualificação do(s) locatário(s)",
    description: "Qualificação narrativa completa de todos os locatários (PF/PJ).",
    example: "Bruno Tavares, brasileiro, casado, médico, …",
    required: true,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "fiador_qualificacao",
    label: "Qualificação do fiador",
    description:
      "Qualificação do fiador quando a garantia é fiança; vazio nas demais garantias.",
    example: "Carlos Pereira, brasileiro, …",
    required: false,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "clausula_garantia",
    label: "Cláusula de garantia",
    description:
      "Texto integral da cláusula de garantia conforme o tipo escolhido no formulário (título de capitalização 8.1–8.6, fiador, caução, seguro-fiança…). Multi-parágrafo.",
    example: "8.1. Para garantir as obrigações assumidas neste contrato…",
    required: false,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "bloco_administradora",
    label: "Cláusula da administradora",
    description:
      "Parágrafo nomeando a administradora (razão social, CRECI, sede) quando a org tem cadastro; fallback pagamento direto à parte locadora.",
    example:
      "Os aluguéis e demais encargos da locação deverão ser pagos pela PARTE LOCATÁRIA…",
    required: false,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "assinaturas",
    label: "Bloco de assinaturas",
    description:
      "Linhas de assinatura de todas as partes (locatários, locadores, fiador) + duas testemunhas.",
    example: "____________________\nBruno Tavares\nPARTE LOCATÁRIA",
    required: false,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "vendedores_qualificacao",
    label: "Qualificação do(s) vendedor(es)",
    description:
      "Qualificação narrativa completa de todos os vendedores (PF/PJ, com cônjuge quando houver).",
    example: "João Silva, brasileiro, casado, …",
    required: true,
    kind: "composed",
    modalidades: VENDA,
  },
  {
    token: "compradores_qualificacao",
    label: "Qualificação do(s) comprador(es)",
    description: "Qualificação narrativa completa de todos os compradores.",
    example: "Carlos Almeida, brasileiro, …",
    required: true,
    kind: "composed",
    modalidades: VENDA,
  },
  {
    token: "parcelas_pagamento",
    label: "Parcelas do pagamento",
    description:
      "Lista completa das parcelas/forma de pagamento (uma linha por parcela, com valor, extenso e condição).",
    example: "a) R$ 500.000,00 (quinhentos mil reais) — Recursos próprios, em até 30 dias…",
    required: false,
    kind: "composed",
    modalidades: VENDA,
  },

  // ——— Simples ———
  {
    token: "imovel_endereco_completo",
    label: "Endereço completo do imóvel",
    description: "Rua, número, complemento, bairro, CEP e cidade/UF do imóvel.",
    example: "Avenida Brigadeiro Faria Lima, nº 3500, apto. 121, Itaim Bibi, CEP 04538-132, São Paulo/SP",
    required: true,
    kind: "simple",
    modalidades: [...TODAS, ...ADMINISTRACAO],
  },
  {
    token: "imovel_descricao",
    label: "Descrição do imóvel",
    description: "Descrição narrativa do imóvel preenchida no formulário.",
    example: "Apartamento residencial com 3 dormitórios…",
    required: false,
    kind: "simple",
    modalidades: TODAS,
  },
  {
    token: "imovel_matricula",
    label: "Matrícula do imóvel",
    description: "Número da matrícula (com cartório quando informado).",
    example: "152.834 do 5º RI de São Paulo/SP",
    required: false,
    kind: "simple",
    modalidades: TODAS,
  },
  {
    token: "imovel_inscricao_iptu",
    label: "Inscrição IPTU/contribuinte",
    description: "Número de contribuinte municipal do imóvel.",
    example: "112.345.6789-0",
    required: false,
    kind: "simple",
    modalidades: TODAS,
  },
  {
    token: "aluguel_valor",
    label: "Valor do aluguel",
    description: "Aluguel mensal formatado em BRL.",
    example: "R$ 3.500,00",
    required: true,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "aluguel_valor_extenso",
    label: "Valor do aluguel por extenso",
    description: "Aluguel mensal por extenso.",
    example: "três mil e quinhentos reais",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "aluguel_dia_vencimento",
    label: "Dia de vencimento",
    description: "Dia do mês do vencimento do aluguel (número + extenso).",
    example: "10 (dez)",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "vigencia_meses",
    label: "Prazo da locação",
    description: "Prazo em meses (número + extenso).",
    example: "30 (trinta)",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "vigencia_inicio",
    label: "Início da vigência",
    description: "Data de início por extenso.",
    example: "1º de julho de 2026",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "vigencia_fim",
    label: "Término da vigência",
    description: "Data de término por extenso (véspera do mesmo dia N meses depois).",
    example: "31 de dezembro de 2028",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "indice_reajuste_texto",
    label: "Índice de reajuste",
    description: "Nome completo do índice de reajuste escolhido.",
    example: "Índice Geral de Preços - Mercado (IGP-M)",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "multa_atraso_percent",
    label: "Multa de atraso (%)",
    description: "Percentual da multa moratória (número + extenso).",
    example: "10% (dez por cento)",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "juros_mensais_atraso",
    label: "Juros de mora (% a.m.)",
    description: "Percentual de juros mensais (número + extenso).",
    example: "1% (um por cento)",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "multa_rescisoria_meses",
    label: "Multa contratual (aluguéis)",
    description: "Quantidade de aluguéis da multa por infração (número + extenso).",
    example: "3 (três)",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "foro_texto",
    label: "Foro",
    description: "Comarca eleita no formulário (ou localização do imóvel).",
    example: "São Paulo",
    required: false,
    kind: "simple",
    modalidades: TODAS,
  },
  {
    token: "data_local_assinatura",
    label: "Local e data da assinatura",
    description: "Cidade/UF e data por extenso do fecho.",
    example: "São Paulo/SP, 9 de junho de 2026",
    required: false,
    kind: "simple",
    modalidades: [...TODAS, ...ADMINISTRACAO],
  },
  {
    token: "preco_total",
    label: "Preço total",
    description: "Preço total do imóvel formatado em BRL.",
    example: "R$ 1.250.000,00",
    required: true,
    kind: "simple",
    modalidades: VENDA,
  },
  {
    token: "preco_total_extenso",
    label: "Preço total por extenso",
    description: "Preço total por extenso.",
    example: "um milhão, duzentos e cinquenta mil reais",
    required: false,
    kind: "simple",
    modalidades: VENDA,
  },
  {
    token: "sinal_valor",
    label: "Sinal/arras",
    description: "Valor do sinal formatado em BRL.",
    example: "R$ 125.000,00",
    required: false,
    kind: "simple",
    modalidades: VENDA,
  },
  {
    token: "comissao_valor",
    label: "Comissão (valor)",
    description: "Valor da comissão de corretagem em BRL.",
    example: "R$ 75.000,00",
    required: false,
    kind: "simple",
    modalidades: VENDA,
  },
  {
    token: "contrato_numero",
    label: "Número do contrato",
    description: "Identificador curto do contrato gerado.",
    example: "AB12CD34-v1",
    required: false,
    kind: "simple",
    modalidades: TODAS,
  },
];

export function catalogForModalidade(modalidade: string): PlaceholderDef[] {
  return PLACEHOLDER_CATALOG.filter((d) =>
    d.modalidades.includes(modalidade as PlaceholderModalidade)
  );
}

export function requiredTokens(modalidade: string): string[] {
  return catalogForModalidade(modalidade)
    .filter((d) => d.required)
    .map((d) => d.token);
}

export function isKnownToken(token: string, modalidade: string): boolean {
  return catalogForModalidade(modalidade).some((d) => d.token === token);
}
