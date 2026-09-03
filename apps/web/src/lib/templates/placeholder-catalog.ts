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
  | "temporada"
  | "a_vista"
  | "financiamento"
  | "administracao_locacao";

/**
 * Como o reverse-merge pode trocar o VALOR deste token no documento-fonte:
 * - `unique` (default): só quando o valor ocorre exatamente 1 vez — trocar
 *   "casa" em todas as ocorrências destruiria "casa de máquinas".
 * - `all`: todas as ocorrências, desde que o valor seja específico
 *   (`isSpecificValue`): o valor do aluguel está na cláusula do preço, na do
 *   reajuste e na da multa, e é o mesmo negócio em todas.
 * Só faz sentido em token `simple`; composto continua `unique`. E número
 * pequeno por extenso ("10 (dez)", "3 (três)", "10% (dez por cento)") fica
 * `unique` de propósito: "10 (dez)" do vencimento também é o "prazo de 10
 * (dez) dias" da desocupação — o formato não diz de qual campo o número é.
 * Repetição desses fica com o passe de IA, que tem o contexto.
 */
export type MatchPolicy = "unique" | "all";

export interface PlaceholderDef {
  token: string;
  label: string;
  description: string;
  example: string;
  required: boolean;
  kind: PlaceholderKind;
  modalidades: PlaceholderModalidade[];
  matchPolicy?: MatchPolicy;
}

// Temporada usa o mesmo schema residencial, então o mesmo catálogo de tokens.
const LOCACAO: PlaceholderModalidade[] = ["locacao", "locacao_comercial", "temporada"];
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
    token: "corretagem_qualificacao",
    label: "Qualificação da corretagem",
    description:
      "Nome, CPF/CNPJ e CRECI do(s) corretor(es) que intermediaram a locação, conforme a etapa Comissão do formulário. Cobre SÓ a qualificação (do nome ao CRECI): sem valor em R$, sem rótulo fixo e SEM a conta/PIX (essa parte é de corretagem_dados_pagamento). Vazio quando o negócio não tem corretor informado.",
    example:
      "Ana Ribeiro, inscrito(a) no CPF/MF sob nº 529.982.247-25, CRECI nº 12.345-F",
    required: false,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "corretagem_dados_pagamento",
    label: "Dados de repasse da corretagem",
    description:
      "Chave PIX ou banco/agência/conta para o repasse da comissão do corretor do negócio. Cobre SÓ o trecho da conta/PIX, sem o nome/CPF/CRECI do corretor (esses são de corretagem_qualificacao). Use no lugar de digitar a conta de alguém no modelo — conta literal no texto do modelo bloqueia a ativação. Vazio quando não há dado de recebimento.",
    example: "na chave PIX (CPF): 529.982.247-25, de titularidade de Ana Ribeiro",
    required: false,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "imobiliaria_qualificacao",
    label: "Qualificação da imobiliária intermediadora",
    description:
      "Razão social, CNPJ, CRECI e sede da PRÓPRIA imobiliária como intermediadora da locação (quem recebe a comissão do 1º aluguel) — vem do perfil da imobiliária, não do formulário. Cobre SÓ da razão social até a sede: sem o valor em R$, sem o rótulo 'a ser pago à imobiliária intermediadora' e SEM a conta/PIX (essa parte é de imobiliaria_dados_pagamento, na mesma frase). Use mesmo quando ela não administra o imóvel. Vazio quando o perfil não tem razão social.",
    example:
      "Imobiliária Exemplo Ltda., inscrita no CNPJ sob nº 12.345.678/0001-90, CRECI nº 12345-J, com sede na Rua das Flores, nº 100, Centro, São Paulo/SP",
    required: false,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "imobiliaria_dados_pagamento",
    label: "Dados de recebimento da imobiliária",
    description:
      "Chave PIX ou banco/agência/conta onde a PRÓPRIA imobiliária recebe a comissão de intermediação (1º aluguel), cadastrada no Perfil da imobiliária. Cobre SÓ o trecho da conta/PIX (ex.: 'na conta corrente nº … agência … banco … (PIX …)'), sem a razão social/CNPJ/sede (esses são de imobiliaria_qualificacao). Use no lugar da conta digitada no modelo — conta literal no texto bloqueia a ativação. Vazio quando a imobiliária não informou.",
    example: "na chave PIX (CNPJ): 12.345.678/0001-90, de titularidade de Imobiliária Exemplo Ltda.",
    required: false,
    kind: "composed",
    modalidades: LOCACAO,
  },
  {
    token: "rateio_primeiro_aluguel",
    label: "Rateio do primeiro aluguel",
    description:
      "A LISTA INTEIRA de quem recebe o primeiro aluguel, um item por beneficiário, com valor em R$ e por extenso, qualificação e via de pagamento (ex.: 'a) R$ 2.500,00 (dois mil e quinhentos reais), a ser pago diretamente à imobiliária intermediadora …; b) R$ 1.200,00 …, a ser pago diretamente ao(à) corretor(a) intermediador(a) …'). Cobre do PRIMEIRO item da lista ao ÚLTIMO — nunca o cabeçalho que a introduz (ex.: '4.1.1. O pagamento correspondente ao primeiro aluguel será rateado da seguinte forma:'), que é texto fixo do modelo. NÃO use corretagem_qualificacao nem corretagem_dados_pagamento item por item: cada uma imprime a lista inteira de corretores, então com dois beneficiários o bloco se repete em todos os itens.",
    example:
      "a) R$ 2.500,00 (dois mil e quinhentos reais), a ser pago diretamente à imobiliária intermediadora Imobiliária Exemplo Ltda., como honorários pela intermediação imobiliária na presente locação, por meio da chave PIX (CNPJ) 12.345.678/0001-90;\nb) R$ 1.200,00 (mil e duzentos reais), a ser pago diretamente ao(à) corretor(a) intermediador(a) Ana Ribeiro, CRECI nº 12345-F.",
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
    matchPolicy: "all",
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
    description: "Descrição narrativa opcional do imóvel preenchida no formulário.",
    example: "Apartamento residencial com 3 dormitórios…",
    required: false,
    kind: "simple",
    modalidades: TODAS,
  },
  // Rebuild da RE/MAX Trio (2026-09-01): 16/16 modelos ingeridos ficaram com
  // "apartamento 33, do condomínio edifício X" do imóvel-fonte literal na
  // cláusula do objeto, porque só o endereço tinha chave. Esta é a chave do
  // trecho que ANTECEDE o endereço — composta de campos que o form sempre tem
  // (tipo, complemento, nome do condomínio), como faz a 1.1 do modelo canônico.
  {
    token: "imovel_identificacao",
    label: "Identificação do imóvel",
    description:
      "Tipo e unidade do imóvel na cláusula do objeto, antes do endereço: " +
      "'apartamento 33, do condomínio edifício X' ou 'casa'. Mapeie o trecho " +
      "entre 'proprietária do(a)' e 'localizado(a) na'.",
    example: "apartamento 33, do condomínio edifício Siracusa",
    required: true,
    // `simple`, não `composed`: é um trecho DENTRO da frase — "composed" faz o
    // passe de IA mapear o bloco inteiro, e ele engoliria o endereço.
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "imovel_matricula",
    matchPolicy: "all",
    label: "Matrícula do imóvel",
    description: "Número da matrícula (com cartório quando informado).",
    example: "152.834 do 5º RI de São Paulo/SP",
    required: false,
    kind: "simple",
    modalidades: TODAS,
  },
  {
    token: "imovel_inscricao_iptu",
    matchPolicy: "all",
    label: "Inscrição IPTU/contribuinte",
    description: "Número de contribuinte municipal do imóvel.",
    example: "112.345.6789-0",
    required: false,
    kind: "simple",
    modalidades: TODAS,
  },
  {
    token: "iptu_valor",
    matchPolicy: "all",
    label: "IPTU mensal",
    description:
      "Valor mensal do IPTU na cláusula de encargos/despesas da locação, em BRL. " +
      "Vazio quando não informado ou zero.",
    example: "R$ 31,67",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "condominio_valor",
    matchPolicy: "all",
    label: "Condomínio mensal",
    description:
      "Valor mensal das despesas ordinárias de condomínio na cláusula de " +
      "encargos/despesas da locação, em BRL. Vazio quando o imóvel não tem " +
      "condomínio (casa) ou o valor é zero.",
    example: "R$ 676,08",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "aluguel_valor",
    matchPolicy: "all",
    label: "Valor do aluguel",
    description: "Aluguel mensal formatado em BRL.",
    example: "R$ 3.500,00",
    required: true,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "aluguel_valor_extenso",
    matchPolicy: "all",
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
    matchPolicy: "all",
    label: "Início da vigência",
    description: "Data de início por extenso.",
    example: "1º de julho de 2026",
    required: false,
    kind: "simple",
    modalidades: LOCACAO,
  },
  {
    token: "vigencia_fim",
    matchPolicy: "all",
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
    matchPolicy: "all",
    label: "Local e data da assinatura",
    description: "Cidade/UF e data por extenso do fecho.",
    example: "São Paulo/SP, 9 de junho de 2026",
    required: false,
    kind: "simple",
    modalidades: [...TODAS, ...ADMINISTRACAO],
  },
  {
    token: "preco_total",
    matchPolicy: "all",
    label: "Preço total",
    description: "Preço total do imóvel formatado em BRL.",
    example: "R$ 1.250.000,00",
    required: true,
    kind: "simple",
    modalidades: VENDA,
  },
  {
    token: "preco_total_extenso",
    matchPolicy: "all",
    label: "Preço total por extenso",
    description: "Preço total por extenso.",
    example: "um milhão, duzentos e cinquenta mil reais",
    required: false,
    kind: "simple",
    modalidades: VENDA,
  },
  {
    token: "sinal_valor",
    matchPolicy: "all",
    label: "Sinal/arras",
    description: "Valor do sinal formatado em BRL.",
    example: "R$ 125.000,00",
    required: false,
    kind: "simple",
    modalidades: VENDA,
  },
  {
    token: "comissao_valor",
    matchPolicy: "all",
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

/**
 * Chaves de DADO: cobrem só o dado em si (uma qualificação, uma via de
 * pagamento) e convivem com vizinhas no mesmo parágrafo. Uma proposta para
 * uma delas que CONTÉM a proposta de outra chave é recusada
 * (`engulfs-neighbor`) em vez de aplicada — medido em produção em 02/09/2026:
 * o item a) inteiro da cláusula de rateio entrou como `imobiliaria_qualificacao`
 * e o parágrafo colapsou, com o gate de PII liberando por cima. Conjunto
 * EXPLÍCITO de propósito (não derivado por sufixo): o teste do catálogo quebra
 * quando entrar uma chave nova, para a decisão ser tomada e não herdada.
 */
export const DATA_KEYS: ReadonlySet<string> = new Set([
  "locadores_qualificacao",
  "locatarios_qualificacao",
  "fiador_qualificacao",
  "vendedores_qualificacao",
  "compradores_qualificacao",
  "corretagem_qualificacao",
  "corretagem_dados_pagamento",
  "imobiliaria_qualificacao",
  "imobiliaria_dados_pagamento",
]);

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

/** Política de casamento do reverse-merge para o token (default `unique`). */
export function matchPolicyFor(token: string, modalidade: string): MatchPolicy {
  return catalogForModalidade(modalidade).find((d) => d.token === token)?.matchPolicy ?? "unique";
}

export function isKnownToken(token: string, modalidade: string): boolean {
  return catalogForModalidade(modalidade).some((d) => d.token === token);
}
