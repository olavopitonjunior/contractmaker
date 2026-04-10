import { slugify } from '../utils/strings';
import {
  CampoIdentificado,
  ClausulaCondicional,
  ClausulaExclusiva,
  ModeloAnalise,
  BlocoRepetivel,
  CampoTipo
} from './types';

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

export function detectFields(text: string): CampoIdentificado[] {
  const results: CampoIdentificado[] = [];

  for (const pattern of FIELD_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const raw = pattern.extractor(match);
      const label = raw.replace(/[\[\]{}]/g, '').trim() || 'campo';
      const id = slugify(label);
      const categoria = detectCategoria(label);
      const tipo = detectTipo(label);
      results.push({
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

  return results;
}

export function detectConditionals(text: string): ClausulaCondicional[] {
  const results: ClausulaCondicional[] = [];
  const paragraphs = text.split(/\n{2,}/g);
  let cursor = 0;
  for (const paragraph of paragraphs) {
    const lower = paragraph.toLowerCase();
    const hasKeyword = CONDITIONAL_KEYWORDS.some((kw) => lower.includes(kw));
    const start = text.indexOf(paragraph, cursor);
    if (hasKeyword && start >= 0) {
      results.push({
        id: slugify(paragraph.slice(0, 30) || 'condicional'),
        texto: paragraph.trim(),
        posicao: { inicio: start, fim: start + paragraph.length },
        condicao_sugerida: 'true',
        confianca: 0.4
      });
    }
    cursor = start + paragraph.length;
  }

  return results;
}

export function detectRepeatables(text: string): BlocoRepetivel[] {
  const results: BlocoRepetivel[] = [];
  const patterns: Array<{ regex: RegExp; entidade: string }> = [
    { regex: /VENDEDOR\s*\d+/gi, entidade: 'vendedor' },
    { regex: /COMPRADOR\s*\d+/gi, entidade: 'comprador' },
    { regex: /IMOVEL\s*\d+/gi, entidade: 'imovel' }
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      results.push({
        id: slugify(`${pattern.entidade}_${match[0]}`),
        texto_exemplo: match[0],
        entidade: pattern.entidade,
        min: 1,
        max: null
      });
    }
  }

  return results;
}

export function detectExclusives(text: string): ClausulaExclusiva[] {
  const results: ClausulaExclusiva[] = [];
  const optionBlocks = text.match(/Opcao\s*[A-Z]:[\s\S]*?(?=Opcao\s*[A-Z]:|$)/gi);
  if (!optionBlocks) return results;

  const opcoes = optionBlocks.map((block, index) => ({
    id: `opcao_${index + 1}`,
    texto: block.trim()
  }));

  results.push({
    id: 'opcoes_detectadas',
    opcoes,
    campo_seletor: 'opcao'
  });

  return results;
}

export function buildAnalysis(text: string): ModeloAnalise {
  const campos = detectFields(text);
  const condicionais = detectConditionals(text);
  const repetiveis = detectRepeatables(text);
  const exclusivas = detectExclusives(text);
  const confianca_geral = campos.length ? 0.5 : 0.1;
  const alertas: string[] = [];

  if (!campos.length) {
    alertas.push('Nenhum campo variavel detectado.');
  }

  return {
    campos,
    condicionais,
    repetiveis,
    exclusivas,
    confianca_geral,
    alertas
  };
}
