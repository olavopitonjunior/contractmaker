export type TipoPessoa = 'fisica' | 'juridica';

export interface PessoaFisica {
  nome: string;
  nacionalidade?: string;
  estado_civil?: string;
  profissao?: string;
  rg?: string;
  cpf?: string;
  email?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  conjuge?: {
    nome?: string;
    cpf?: string;
    rg?: string;
    nacionalidade?: string;
    profissao?: string;
  };
  tem_procurador?: boolean;
  procurador?: {
    nome?: string;
    cpf?: string;
    rg?: string;
    endereco?: string;
    numero?: string;
    cidade?: string;
    uf?: string;
  };
}

export interface PessoaJuridica {
  razao_social?: string;
  cnpj?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  representante?: {
    nome?: string;
    cpf?: string;
    nacionalidade?: string;
    estado_civil?: string;
    profissao?: string;
  };
}

export type Parte = ({ tipo_pessoa: 'fisica' } & PessoaFisica) | ({ tipo_pessoa: 'juridica' } & PessoaJuridica);

export interface Imovel {
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  matricula?: string;
  cartorio?: string;
  inscricao_iptu?: string;
  descricao?: string;
}

export interface Parcela {
  tipo_texto?: string;
  dias?: number;
  valor: number;
}

export interface Configuracao {
  multa_penal_moratoria: number;
  base_calculo_multa: string;
  juros_mensais_atraso: number;
  atualizacao_monetaria: string;
  prazo_atraso_rescisao: number;
  multa_cominatoria_diaria: number;
  multa_penal_compensatoria: number;
  prazo_multa_rescisoria: number;
}

export interface DadosContrato {
  vendedores: Parte[];
  compradores: Parte[];
  anuente?: Parte;

  imoveis: Imovel[];
  status_propriedade: 'financiamento-quitado' | 'financiado-saldo' | 'quitado-registrado';
  saldo_devedor?: number;

  tem_debitos: boolean;
  debitos: {
    iptu: { selecionado: boolean; valor: number };
    condominio: { selecionado: boolean; valor: number };
    outros?: string;
  };

  vicios: {
    opcao: 'padrao' | 'reparar' | 'desocultados' | 'renuncia' | 'detalhado';
    descricao_reparar?: string;
    descricao_desocultados?: string;
  };

  debitos_assumidos: {
    assume: boolean;
    descricao?: string;
  };

  regularizacoes: {
    tem: boolean;
    prazo_dias?: number;
    descricao?: string;
  };

  pagamento: {
    valor_total: number;
    sinal_arras: number;
    recursos_proprios: number;
    fgts: number;
    cessao_consorcio: number;
    cessao_consorcio_descricao?: string;
    alienacao_fiduciaria: number;
    outras_formas: number;
    outras_formas_descricao?: string;
    meio_pagamento: string;
    parcelas: Parcela[];
  };

  incluso_no_preco: string;

  ocupacao: 'desocupado' | 'ocupado-vendedor' | 'ocupado-terceiro';
  locacao?: {
    data_preferencia: string;
    situacao: 'vendedor-entregara' | 'comprador-mantem';
  };
  entrega_posse: {
    momento: string;
    momento_texto: string;
  };

  titulo_definitivo: {
    prazo_dias: number;
    opcao: 'padrao' | 'usufruto' | 'certidoes-apos';
  };

  comissao: {
    valor: number;
    quem_paga: string;
    quem_paga_texto: string;
    quando_paga: string;
    quando_paga_texto: string;
    imobiliaria_nome: string;
    imobiliaria_cnpj: string;
  };

  desistencia: {
    permite: boolean;
    prazo_dias?: number;
  };

  foro: 'arbitragem' | 'justica-publica';

  assinatura: {
    cidade: string;
    uf: string;
    data: string;
  };
  testemunhas: Array<{ nome: string; cpf: string }>;

  config: Configuracao;
}
