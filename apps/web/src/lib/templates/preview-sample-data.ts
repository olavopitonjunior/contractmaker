/**
 * Sample data canônica para preview de templates de contrato. Cobre todas
 * as condicionais que os templates v2 testam (PF/PJ, com/sem cônjuge, com
 * procurador, múltiplas partes, parcelas, intermediadora PF/PJ).
 *
 * Usado por POST /api/templates/[id]/preview, NUNCA persiste em DB nem em
 * deals reais.
 */

export const previewSampleDataAVista = {
  modalidade: "a_vista",
  vendedores: [
    {
      tipo_pessoa: "fisica",
      nome: "João Silva Santos",
      nacionalidade: "Brasileiro",
      estado_civil: "Casado(a)",
      profissao: "Engenheiro Civil",
      rg: "12.345.678-9",
      cpf: "123.456.789-00",
      email: "joao.silva@example.com",
      mobile_phone: "(11) 98888-1111",
      endereco: "Rua das Acácias",
      numero: "100",
      complemento: "Apto 502",
      bairro: "Vila Mariana",
      cidade: "São Paulo",
      uf: "SP",
      cep: "04101-000",
      conjuge: {
        nome: "Maria Aparecida Santos",
        cpf: "234.567.890-11",
        rg: "23.456.789-0",
        nacionalidade: "Brasileira",
        profissao: "Médica",
        email: "maria.santos@example.com",
        mobile_phone: "(11) 98888-2222",
      },
      tem_procurador: true,
      procurador: {
        nome: "Pedro Henrique Costa",
        cpf: "345.678.901-22",
        rg: "34.567.890-1",
        endereco: "Av. Paulista",
        numero: "1500",
        cidade: "São Paulo",
        uf: "SP",
      },
    },
    {
      tipo_pessoa: "juridica",
      razao_social: "Imóveis & Cia Ltda",
      cnpj: "12.345.678/0001-90",
      endereco: "Rua dos Pinheiros",
      numero: "200",
      complemento: "Sala 1010",
      bairro: "Pinheiros",
      cidade: "São Paulo",
      uf: "SP",
      cep: "05422-000",
      representante: {
        nome: "Ana Carolina Ribeiro",
        cpf: "456.789.012-33",
        nacionalidade: "Brasileira",
        estado_civil: "Solteiro(a)",
        profissao: "Administradora",
        email: "ana.ribeiro@example.com",
        mobile_phone: "(11) 98888-3333",
      },
    },
  ],
  compradores: [
    {
      tipo_pessoa: "fisica",
      nome: "Carlos Eduardo Almeida",
      nacionalidade: "Brasileiro",
      estado_civil: "União Estável",
      profissao: "Médico",
      rg: "45.678.901-2",
      cpf: "567.890.123-44",
      email: "carlos.almeida@example.com",
      mobile_phone: "(11) 97777-1111",
      endereco: "Rua Augusta",
      numero: "2500",
      complemento: "Cobertura",
      bairro: "Cerqueira César",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01412-100",
      conjuge: {
        nome: "Beatriz Oliveira Lima",
        cpf: "678.901.234-55",
        rg: "56.789.012-3",
        nacionalidade: "Brasileira",
        profissao: "Arquiteta",
        email: "beatriz.lima@example.com",
        mobile_phone: "(11) 97777-2222",
      },
      tem_procurador: false,
    },
    {
      tipo_pessoa: "fisica",
      nome: "Juliana Pereira Mendes",
      nacionalidade: "Brasileira",
      estado_civil: "Solteiro(a)",
      profissao: "Advogada",
      rg: "67.890.123-4",
      cpf: "789.012.345-66",
      email: "juliana.mendes@example.com",
      mobile_phone: "(11) 97777-3333",
      endereco: "Alameda Santos",
      numero: "800",
      bairro: "Jardim Paulista",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01418-100",
      tem_procurador: false,
    },
  ],
  imoveis: [
    {
      rua: "Avenida Brigadeiro Faria Lima",
      numero: "3500",
      complemento: "Apto 121",
      bairro: "Itaim Bibi",
      cidade: "São Paulo",
      uf: "SP",
      cep: "04538-132",
      matricula: "152.834",
      cartorio: "5º Cartório de Registro de Imóveis de São Paulo/SP",
      inscricao_iptu: "112.345.6789-0",
      inscricao_municipal: "112.345.6789-0",
      sql: "045.123.0099-1",
      descricao:
        "Apartamento residencial composto por 3 dormitórios sendo 1 suíte, sala ampla com 2 ambientes, cozinha americana, lavabo, banheiro social e área de serviço, totalizando 142,50m² de área privativa, acompanhado de 2 vagas de garagem demarcadas e direito a uso de 1 box no subsolo do edifício.",
    },
  ],
  pagamento: {
    valor_total: 1250000,
    sinal_arras: 125000,
    recursos_proprios: 1125000,
    parcelas: [
      {
        tipo_texto: "Recursos próprios",
        valor: 500000,
        dias: 30,
      },
      {
        tipo_texto: "Recursos próprios",
        valor: 625000,
        dias: 60,
      },
    ],
  },
  comissao: {
    corretora_tipo_pessoa: "fisica",
    imobiliaria_nome: "Roberto Carvalho Imóveis",
    imobiliaria_cnpj: "111.222.333-44",
    imobiliaria_email: "roberto.carvalho@example.com",
    creci: "F-12345/SP",
    valor: 75000,
    percentual: 6,
    comissionados: [
      {
        tipo_pessoa: "fisica",
        nome: "Roberto Carvalho",
        cpf: "111.222.333-44",
        creci: "F-12345/SP",
        email: "roberto.carvalho@example.com",
        mobile_phone: "(11) 96666-1111",
        papel: "imobiliaria_principal",
        percentual: 100,
      },
    ],
  },
  config: {
    titulo_aquisitivo: "Escritura Pública de Compra e Venda lavrada em 15/03/2018",
    registro_aquisitivo: "R-3 da matrícula 152.834",
    prazo_posse_dias: 30,
    prazo_escritura_dias: 60,
    multa_diaria_posse: 500,
    multa_diaria_escritura: 300,
  },
  entrega_posse: {
    momento: "pagamento_integral",
  },
  assinatura: {
    cidade: "São Paulo",
    uf: "SP",
    data: "2026-05-19",
  },
  observacao_imovel:
    "O imóvel encontra-se livre e desembaraçado de qualquer ônus, dívida ou gravame.",
};

export const previewSampleDataFinanciamento = {
  ...previewSampleDataAVista,
  modalidade: "financiamento",
  pagamento: {
    valor_total: 1250000,
    sinal_arras: 125000,
    alienacao_fiduciaria: 875000,
    fgts: 250000,
    recursos_proprios: 0,
    parcelas: [
      {
        tipo_texto: "Saque do FGTS",
        valor: 250000,
        dias: 45,
      },
      {
        tipo_texto: "Liberação do financiamento bancário",
        valor: 875000,
        dias: 60,
      },
    ],
  },
};

// Locação residencial — cobre as condicionais do locacao_residencial_v3.hbs:
// PF + PJ, fiador ausente (garantia = título de capitalização), administradora
// nomeada, vagas/condomínio, IPTU/condomínio de referência.
export const previewSampleDataLocacao = {
  locadores: [
    {
      tipo_pessoa: "fisica",
      nome: "Helena Castro Natrielli",
      nacionalidade: "Brasileira",
      estado_civil: "Viúvo(a)",
      profissao: "Engenheira",
      rg: "11.222.333-4",
      cpf: "123.456.789-00",
      email: "helena.castro@example.com",
      mobile_phone: "(11) 98888-1111",
      endereco: "Rua das Acácias",
      numero: "100",
      complemento: "Apto 502",
      bairro: "Vila Mariana",
      cidade: "São Paulo",
      uf: "SP",
      cep: "04101-000",
    },
    {
      tipo_pessoa: "juridica",
      razao_social: "Patrimonial Castro Ltda",
      cnpj: "12.345.678/0001-90",
      endereco: "Rua dos Pinheiros",
      numero: "200",
      complemento: "Sala 1010",
      bairro: "Pinheiros",
      cidade: "São Paulo",
      uf: "SP",
      cep: "05422-000",
      representante: {
        nome: "Ana Carolina Ribeiro",
        cpf: "456.789.012-33",
      },
    },
  ],
  locatarios: [
    {
      tipo_pessoa: "fisica",
      nome: "Carlos Eduardo Almeida",
      nacionalidade: "Brasileiro",
      estado_civil: "Casado(a)",
      profissao: "Médico",
      rg: "45.678.901-2",
      cpf: "567.890.123-44",
      email: "carlos.almeida@example.com",
      mobile_phone: "(11) 97777-1111",
      endereco: "Rua Augusta",
      numero: "2500",
      complemento: "Cobertura",
      bairro: "Cerqueira César",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01412-100",
      // Casado(a) com cônjuge preenchido — exercita a outorga uxória na
      // qualificação e a linha de assinatura do cônjuge.
      conjuge: {
        nome: "Beatriz Almeida Nogueira",
        cpf: "890.123.456-77",
        rg: "33.444.555-6",
        nacionalidade: "Brasileira",
        profissao: "Arquiteta",
        email: "beatriz.nogueira@example.com",
        mobile_phone: "(11) 97777-2222",
        endereco_igual_ao_titular: true,
      },
    },
  ],
  imovel: {
    kind: "apartamento",
    rua: "Avenida Brigadeiro Faria Lima",
    numero: "3500",
    complemento: "Apto 121",
    bairro: "Itaim Bibi",
    cidade: "São Paulo",
    uf: "SP",
    cep: "04538-132",
    matricula: "152.834",
    cartorio: "5º Cartório de Registro de Imóveis de São Paulo/SP",
    inscricao_iptu: "112.345.6789-0",
    area: 142.5,
    vagas_garagem: 2,
    condominio_nome: "Condomínio Edifício Faria Lima Square",
    descricao:
      "Apartamento residencial composto por 3 dormitórios sendo 1 suíte, sala ampla com 2 ambientes, cozinha americana, lavabo, banheiro social e área de serviço, totalizando 142,50m² de área privativa.",
  },
  aluguel: {
    valor: 8500,
    encargos: 0,
    dia_vencimento: 10,
    indice_reajuste: "IGPM",
    vigencia_inicio: "2026-07-01",
    vigencia_meses: 30,
    meio_pagamento: "boleto",
    iptu_mensal: 650,
    condominio_mensal: 1800,
  },
  garantia: {
    tipo: "titulo_capitalizacao",
    provider: "Porto Seguro Capitalização S.A.",
    titulo_valor: 25500,
    titulo_proposta: "1234567-001",
  },
  foro: "São Paulo/SP",
  assinatura: {
    cidade: "São Paulo",
    uf: "SP",
    data: "2026-06-09",
  },
  config: {
    administradora_nome: "Imobiliária Exemplo Negócios Imobiliários Ltda",
    administradora_creci: "24.342-J/SP",
    administradora_endereco: "Rua Roque Petrella, 188, Brooklin, CEP 04581-050, São Paulo/SP",
  },
  // Corretagem: existe para a pré-visualização mostrar o que
  // `{{corretagem_qualificacao}}` e `{{corretagem_dados_pagamento}}` produzem —
  // é decidindo isso que o operador escolhe usar a chave em vez de digitar a
  // conta de alguém no modelo. Pessoa e chave PIX inventadas.
  comissao: {
    taxa_locacao_percent: 10,
    angariadores: [
      {
        nome: "Ana Ribeiro",
        tipo_pessoa: "fisica",
        cpf: "52998224725",
        creci: "12.345-F",
        forma_comissao: "percentual",
        percentual: 100,
        recebimento: {
          pix_chave: "ana.ribeiro@exemplo.com.br",
          pix_tipo_chave: "EMAIL",
          titular_nome: "Ana Ribeiro",
          titular_doc: "52998224725",
        },
      },
    ],
  },
};

export const previewSampleDataLocacaoComercial = {
  ...previewSampleDataLocacao,
  imovel: {
    ...previewSampleDataLocacao.imovel,
    kind: "comercial_sala",
    destinacao: "comércio varejista de vestuário e acessórios",
    descricao:
      "Sala comercial com recepção, 2 ambientes de atendimento, copa e banheiro privativo, totalizando 85m² de área privativa.",
  },
};

/**
 * Administração de locação (imobiliária ↔ proprietário). O template só usa
 * `locadores`, `imovel`, `aluguel`, `comissao.taxa_locacao_percent` e `config`
 * — o resto do `config` (taxa de administração, repasse, foro, vigência) é
 * materializado por `enrichLocacaoData`. Reaproveita a amostra de locação
 * residencial porque as partes e o imóvel são os mesmos do negócio.
 */
export const previewSampleDataAdministracaoLocacao = {
  ...previewSampleDataLocacao,
  comissao: {
    taxa_locacao_percent: 100,
  },
  config: {
    ...previewSampleDataLocacao.config,
    taxa_admin_percent: 10,
    administracao_exclusiva: true,
  },
};

// ——————————————————————————————————————————————————————————————————————
// PROPOSTAS. Schema próprio (`proposta_*`): as partes e os imóveis são listas,
// e o bloco de negócio fica em `pagamento` (venda) ou `locacao` (aluguel) —
// NÃO em `aluguel`, que é o vocabulário do contrato. As amostras de aluguel
// carregam os dois porque `enrichLocacaoData` lê `aluguel`/`imovel` pra
// materializar `config` (foro, multas, vigência) e o template da proposta lê
// `locacao`/`imoveis`.
// ——————————————————————————————————————————————————————————————————————

export const previewSampleDataPropostaVenda = {
  compradores: [
    {
      nome: "Carlos Eduardo Almeida",
      cpf: "567.890.123-44",
      email: "carlos.almeida@example.com",
      mobile_phone: "(11) 97777-1111",
      profissao: "Médico",
      estado_civil: "Casado(a)",
      renda: 42000,
      endereco: "Rua Augusta",
      numero: "2500",
      bairro: "Cerqueira César",
      cidade: "São Paulo",
      uf: "SP",
    },
    {
      nome: "Beatriz Oliveira Lima",
      cpf: "678.901.234-55",
      email: "beatriz.lima@example.com",
      profissao: "Arquiteta",
      cidade: "São Paulo",
      uf: "SP",
    },
  ],
  vendedores: [
    {
      nome: "João Silva Santos",
      cpf: "123.456.789-00",
      email: "joao.silva@example.com",
      cidade: "São Paulo",
      uf: "SP",
    },
  ],
  imoveis: [
    {
      endereco: "Avenida Brigadeiro Faria Lima",
      rua: "Avenida Brigadeiro Faria Lima",
      numero: "3500",
      complemento: "Apto 121",
      bairro: "Itaim Bibi",
      cidade: "São Paulo",
      uf: "SP",
      cep: "04538-132",
      matricula: "152.834",
    },
  ],
  pagamento: {
    valor_total: 1250000,
    sinal: 125000,
    sinal_arras: 125000,
    forma:
      "sinal de 10% na assinatura e o saldo em recursos próprios em até 60 dias",
  },
  comissao: {
    percentual: 6,
    valor: 75000,
  },
  config: {
    condicoes_internas:
      "Proposta válida por 5 (cinco) dias úteis. Sujeita à análise da documentação do imóvel.",
  },
  assinatura: {
    cidade: "São Paulo",
    uf: "SP",
    data: "2026-05-19",
  },
};

export const previewSampleDataPropostaLocacaoResidencial = {
  locadores: [
    {
      nome: "Helena Castro Natrielli",
      cpf: "123.456.789-00",
      email: "helena.castro@example.com",
      cidade: "São Paulo",
      uf: "SP",
    },
  ],
  locatarios: [
    {
      nome: "Carlos Eduardo Almeida",
      cpf: "567.890.123-44",
      email: "carlos.almeida@example.com",
      mobile_phone: "(11) 97777-1111",
      profissao: "Médico",
      renda: 28000,
      bairro: "Cerqueira César",
      cidade: "São Paulo",
      uf: "SP",
    },
  ],
  imoveis: [
    {
      endereco: "Avenida Brigadeiro Faria Lima",
      numero: "3500",
      complemento: "Apto 121",
      bairro: "Itaim Bibi",
      cidade: "São Paulo",
      uf: "SP",
      cep: "04538-132",
    },
  ],
  locacao: {
    valor_aluguel: 8500,
    prazo_meses: 30,
    data_entrada: "2026-07-01",
    garantia: "Título de capitalização (Porto Seguro), no valor de 3 aluguéis",
  },
  comissao: {
    percentual: 100,
    valor: 8500,
  },
  // Lidos pelo enrich de locação (config: foro, multas, vigência).
  imovel: previewSampleDataLocacao.imovel,
  aluguel: previewSampleDataLocacao.aluguel,
  foro: "São Paulo/SP",
  config: {
    condicoes_internas:
      "Proposta condicionada à aprovação cadastral e à assinatura do contrato em até 10 dias.",
  },
};

export const previewSampleDataPropostaLocacaoComercial = {
  ...previewSampleDataPropostaLocacaoResidencial,
  locatarios: [
    {
      razao_social: "Vestuário Bom Retiro Comércio Ltda",
      nome: "Vestuário Bom Retiro Comércio Ltda",
      cnpj: "12.345.678/0001-90",
      email: "contato@bomretiro.example.com",
      cidade: "São Paulo",
      uf: "SP",
    },
  ],
  locacao: {
    ...previewSampleDataPropostaLocacaoResidencial.locacao,
    destinacao: "comércio varejista de vestuário e acessórios",
    luvas: 25000,
  },
  imovel: previewSampleDataLocacaoComercial.imovel,
};

const SAMPLE_BY_MODALIDADE: Record<string, Record<string, unknown>> = {
  a_vista: previewSampleDataAVista as Record<string, unknown>,
  financiamento: previewSampleDataFinanciamento as Record<string, unknown>,
  locacao: previewSampleDataLocacao as Record<string, unknown>,
  locacao_comercial: previewSampleDataLocacaoComercial as Record<string, unknown>,
  // Mesma amostra da residencial (mesmo schemaType) — sem entrada aqui o
  // preview renderiza um documento vazio.
  temporada: previewSampleDataLocacao as Record<string, unknown>,
  administracao_locacao: previewSampleDataAdministracaoLocacao as Record<string, unknown>,
  proposta_venda: previewSampleDataPropostaVenda as Record<string, unknown>,
  proposta_locacao_residencial:
    previewSampleDataPropostaLocacaoResidencial as Record<string, unknown>,
  proposta_locacao_comercial:
    previewSampleDataPropostaLocacaoComercial as Record<string, unknown>,
};

export function getPreviewSampleData(
  modalidade: string | null | undefined
): Record<string, unknown> {
  return (
    SAMPLE_BY_MODALIDADE[modalidade ?? ""] ??
    (previewSampleDataAVista as Record<string, unknown>)
  );
}
