export type CampoTipo = 'texto' | 'numero' | 'data' | 'moeda' | 'cpf' | 'cnpj' | 'cep' | 'email';

export interface Posicao {
  inicio: number;
  fim: number;
}

export interface CampoIdentificado {
  id: string;
  padrao_encontrado: string;
  posicao: Posicao;
  tipo: CampoTipo;
  categoria?: string;
  obrigatorio?: boolean;
  sugestao_formulario: string;
}

export interface ClausulaCondicional {
  id: string;
  texto: string;
  posicao: Posicao;
  condicao_sugerida: string;
  confianca: number;
}

export interface BlocoRepetivel {
  id: string;
  texto_exemplo: string;
  entidade: string;
  min?: number;
  max?: number | null;
}

export interface ClausulaExclusiva {
  id: string;
  opcoes: Array<{ id: string; texto: string }>;
  campo_seletor: string;
}

export interface ModeloAnalise {
  campos: CampoIdentificado[];
  condicionais: ClausulaCondicional[];
  repetiveis: BlocoRepetivel[];
  exclusivas: ClausulaExclusiva[];
  confianca_geral: number;
  alertas: string[];
}
