import { slugify } from './strings';

export type CampoTipo = 'texto' | 'numero' | 'data' | 'moeda' | 'cpf' | 'cnpj' | 'cep' | 'email';

export interface ModeloAnalise {
  campos: Array<{ id: string; padrao_encontrado: string; posicao: { inicio: number; fim: number }; tipo: CampoTipo; categoria?: string; obrigatorio?: boolean; sugestao_formulario: string }>;
  condicionais: Array<{ id: string; texto: string; posicao: { inicio: number; fim: number }; condicao_sugerida: string; confianca: number }>;
  repetiveis: Array<{ id: string; texto_exemplo: string; entidade: string; min?: number; max?: number | null }>;
  exclusivas: Array<{ id: string; opcoes: Array<{ id: string; texto: string }>; campo_seletor: string }>;
  confianca_geral: number;
  alertas: string[];
}

const FIELD_PATTERNS: Array<{ regex: RegExp; extractor: (match: RegExpExecArray) => string }> = [
  { regex: /\[[^\]]+\]/g, extractor: (m) => m[0] },
  { regex: /\{[^}]+\}/g, extractor: (m) => m[0] },
  { regex: /_{4,}/g, extractor: (m) => m[0] }
];

const CONDITIONAL_KEYWORDS = ['caso', 'se ', 'quando', 'na hipotese', 'desde que'];

function detectTipo(label: string): CampoTipo {
  const normalized = label.toLowerCase();
  if (normalized.includes('cpf')) return 'cpf';
  if (normalized.includes('cnpj')) return 'cnpj';
  if (normalized.includes('cep')) return 'cep';
  if (normalized.includes('email')) return 'email';
  if (normalized.includes('data')) return 'data';
  if (normalized.includes('valor') || normalized.includes('r$')) return 'moeda';
  if (normalized.includes('numero')) return 'numero';
  return 'texto';
}

function detectCategoria(label: string): string | undefined {
  const normalized = label.toLowerCase();
  if (normalized.includes('vendedor')) return 'vendedor';
  if (normalized.includes('comprador')) return 'comprador';
  if (normalized.includes('imovel')) return 'imovel';
  if (normalized.includes('pagamento')) return 'pagamento';
  if (normalized.includes('comissao')) return 'comissao';
  return undefined;
}

function suggestFieldPath(id: string, categoria?: string): string {
  if (!categoria) return `custom.${id}`;
  switch (categoria) {
    case 'vendedor':
      return `vendedores[0].${id}`;
    case 'comprador':
      return `compradores[0].${id}`;
    case 'imovel':
      return `imoveis[0].${id}`;
    case 'pagamento':
      return `pagamento.${id}`;
    case 'comissao':
      return `comissao.${id}`;
    default:
      return `custom.${id}`;
  }
}

export function buildHeuristicAnalysis(text: string): ModeloAnalise {
  const campos = [] as ModeloAnalise['campos'];
  for (const pattern of FIELD_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const raw = pattern.extractor(match);
      const label = raw.replace(/[\[\]{}]/g, '').trim() || 'campo';
      const id = slugify(label);
      const categoria = detectCategoria(label);
      const tipo = detectTipo(label);
      campos.push({
        id,
        padrao_encontrado: raw,
        posicao: { inicio: match.index, fim: match.index + raw.length },
        tipo,
        categoria,
        obrigatorio: false,
        sugestao_formulario: suggestFieldPath(id, categoria)
      });
    }
  }

  const condicionais = [] as ModeloAnalise['condicionais'];
  const paragraphs = text.split(/\n{2,}/g);
  let cursor = 0;
  for (const paragraph of paragraphs) {
    const lower = paragraph.toLowerCase();
    const hasKeyword = CONDITIONAL_KEYWORDS.some((kw) => lower.includes(kw));
    const start = text.indexOf(paragraph, cursor);
    if (hasKeyword && start >= 0) {
      condicionais.push({
        id: slugify(paragraph.slice(0, 30) || 'condicional'),
        texto: paragraph.trim(),
        posicao: { inicio: start, fim: start + paragraph.length },
        condicao_sugerida: 'true',
        confianca: 0.4
      });
    }
    cursor = start + paragraph.length;
  }

  const repetiveis = [] as ModeloAnalise['repetiveis'];
  const patterns: Array<{ regex: RegExp; entidade: string }> = [
    { regex: /VENDEDOR\s*\d+/gi, entidade: 'vendedor' },
    { regex: /COMPRADOR\s*\d+/gi, entidade: 'comprador' },
    { regex: /IMOVEL\s*\d+/gi, entidade: 'imovel' }
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      repetiveis.push({
        id: slugify(`${pattern.entidade}_${match[0]}`),
        texto_exemplo: match[0],
        entidade: pattern.entidade,
        min: 1,
        max: null
      });
    }
  }

  return {
    campos,
    condicionais,
    repetiveis,
    exclusivas: [],
    confianca_geral: campos.length ? 0.5 : 0.1,
    alertas: campos.length ? [] : ['Nenhum campo variavel detectado.']
  };
}
