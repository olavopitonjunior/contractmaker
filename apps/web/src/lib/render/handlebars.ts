import Handlebars from 'handlebars';

function valorPorExtenso(valor: number): string {
  if (Number.isNaN(valor) || valor === null || valor === undefined) return '';

  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
    'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  if (valor === 0) return 'zero reais';

  function grupoAteNovecentos(n: number): string {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100);
    const resto = n % 100;
    const d = Math.floor(resto / 10);
    const u = resto % 10;

    const partes: string[] = [];
    if (c > 0) partes.push(centenas[c]);
    if (resto > 0 && resto < 20) {
      partes.push(unidades[resto]);
    } else if (resto >= 20) {
      partes.push(dezenas[d]);
      if (u > 0) partes.push(unidades[u]);
    }
    return partes.join(' e ');
  }

  const inteiro = Math.floor(Math.abs(valor));
  const centavosNum = Math.round((Math.abs(valor) - inteiro) * 100);

  const escalas = [
    { divisor: 1000000000, singular: 'bilhão', plural: 'bilhões' },
    { divisor: 1000000, singular: 'milhão', plural: 'milhões' },
    { divisor: 1000, singular: 'mil', plural: 'mil' },
    { divisor: 1, singular: '', plural: '' },
  ];

  const partes: string[] = [];
  let resto = inteiro;

  for (const escala of escalas) {
    const qtd = Math.floor(resto / escala.divisor);
    resto = resto % escala.divisor;
    if (qtd > 0) {
      const grupo = grupoAteNovecentos(qtd);
      if (escala.divisor === 1) {
        partes.push(grupo);
      } else if (qtd === 1) {
        partes.push(escala.divisor === 1000 ? 'mil' : `${grupo} ${escala.singular}`);
      } else {
        partes.push(`${grupo} ${escala.plural}`);
      }
    }
  }

  let resultado = partes.join(', ');

  // Add "e" before last part if there are centenas/dezenas after milhares
  const lastComma = resultado.lastIndexOf(', ');
  if (lastComma > 0) {
    const after = resultado.slice(lastComma + 2);
    if (!after.includes(' mil') && !after.includes(' milh') && !after.includes(' bilh')) {
      resultado = resultado.slice(0, lastComma) + ' e ' + after;
    }
  }

  if (inteiro === 1) {
    resultado += ' real';
  } else if (inteiro > 0) {
    resultado += ' reais';
  }

  if (centavosNum > 0) {
    const centavosExtenso = grupoAteNovecentos(centavosNum);
    if (inteiro > 0) resultado += ' e ';
    resultado += centavosExtenso + (centavosNum === 1 ? ' centavo' : ' centavos');
  }

  if (inteiro === 0 && centavosNum > 0) {
    // just centavos
  }

  return resultado;
}

export function registerHandlebarsHelpers(): void {
  Handlebars.registerHelper('moeda', (valor: number) => {
    if (valor === null || valor === undefined) return '';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(valor);
  });

  Handlebars.registerHelper('extenso', (valor: number) => {
    if (valor === null || valor === undefined) return '';
    return valorPorExtenso(valor);
  });

  // Numero por extenso SEM o sufixo "reais" (para prazos, percentuais, quantidades)
  Handlebars.registerHelper('numeroExtenso', (valor: number) => {
    if (valor === null || valor === undefined) return '';
    const full = valorPorExtenso(valor);
    return full.replace(/\s*reais?$/, '').replace(/\s*real$/, '');
  });

  // Formata numero no padrao brasileiro (virgula decimal, ponto milhar).
  // Ex: 0.71 -> "0,71" | 1234.56 -> "1.234,56"
  Handlebars.registerHelper('numero', (valor: number, decimais?: number) => {
    if (valor === null || valor === undefined) return '';
    const opts: Intl.NumberFormatOptions = {};
    if (typeof decimais === 'number') {
      opts.minimumFractionDigits = decimais;
      opts.maximumFractionDigits = decimais;
    }
    return new Intl.NumberFormat('pt-BR', opts).format(Number(valor));
  });

  // Percentual de `valor` sobre `total` no padrao brasileiro (virgula decimal).
  // Ex: 75000 / 1250000 -> "6,00%"
  Handlebars.registerHelper('percentual', (valor: number, total: number) => {
    const v = Number(valor);
    const t = Number(total);
    if (!t || !Number.isFinite(v) || !Number.isFinite(t)) return '0,00%';
    const pct = (v / t) * 100;
    return (
      new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(pct) + '%'
    );
  });

  Handlebars.registerHelper('cpf', (cpf: string) => {
    if (!cpf) return '';
    const digits = cpf.replace(/\D/g, '');
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  });

  Handlebars.registerHelper('cnpj', (cnpj: string) => {
    if (!cnpj) return '';
    const digits = cnpj.replace(/\D/g, '');
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  });

  Handlebars.registerHelper('cep', (cep: string) => {
    if (!cep) return '';
    const digits = cep.replace(/\D/g, '');
    return digits.replace(/(\d{5})(\d{3})/, '$1-$2');
  });

  Handlebars.registerHelper('dataExtenso', (data: string | Date) => {
    if (!data) return '';
    // Âncora ao meio-dia local pra strings YYYY-MM-DD: sem isso, `new Date("2026-05-19")`
    // vira meia-noite UTC e desliza pro dia anterior em UTC-3 (ex.: "18 de maio").
    // Mesmo padrão de contract-generation.ts (momento_data_texto).
    let parsed: Date;
    if (data instanceof Date) {
      parsed = data;
    } else {
      const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data).trim());
      parsed = ymd
        ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0)
        : new Date(String(data));
    }
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(parsed);
  });

  // Numeração sequencial de subcláusulas (A4 — QA deal 20486). Conta por
  // "grupo" (ex.: "2.1", "5") e incrementa a cada render. Como subcláusulas
  // condicionais ({{#if}}) só chamam o helper quando renderizadas, a sequência
  // fica contígua — sem buracos tipo 2.1.1 → 2.1.2 → 2.1.4. Os contadores são
  // zerados no início de cada `renderContratoHTML` (render é síncrono).
  Handlebars.registerHelper('subnum', (group: string) => {
    const key = String(group);
    const next = (subnumCounters.get(key) ?? 0) + 1;
    subnumCounters.set(key, next);
    return next;
  });

  Handlebars.registerHelper('eq', (a, b) => a === b);

  Handlebars.registerHelper('or', (...args) => {
    args.pop();
    return args.some(Boolean);
  });

  Handlebars.registerHelper('gt', (a, b) => a > b);

  Handlebars.registerHelper('existe', (val) => val !== null && val !== undefined && val !== '');
}

let helpersRegistered = false;

// Contadores do helper `subnum`, zerados a cada render (ver registerHandlebarsHelpers).
const subnumCounters = new Map<string, number>();

export function renderContratoHTML(templateSource: string, data: Record<string, unknown>): string {
  if (!helpersRegistered) {
    registerHandlebarsHelpers();
    helpersRegistered = true;
  }
  subnumCounters.clear();
  const template = Handlebars.compile(templateSource, { noEscape: true });
  return template(data);
}
