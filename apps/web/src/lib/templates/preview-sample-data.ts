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
    creci: "F-12345/SP",
    valor: 75000,
    percentual: 6,
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

export function getPreviewSampleData(
  modalidade: "a_vista" | "financiamento" | string | null | undefined
): Record<string, unknown> {
  if (modalidade === "financiamento") {
    return previewSampleDataFinanciamento as Record<string, unknown>;
  }
  return previewSampleDataAVista as Record<string, unknown>;
}
