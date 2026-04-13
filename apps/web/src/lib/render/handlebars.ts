import Handlebars from 'handlebars';

function valorPorExtenso(valor: number): string {
  if (Number.isNaN(valor) || valor === null || valor === undefined) return '';

  const unidades = ['', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
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
    { divisor: 1000000000, singular: 'bilhao', plural: 'bilhoes' },
    { divisor: 1000000, singular: 'milhao', plural: 'milhoes' },
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
    const parsed = data instanceof Date ? data : new Date(data);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(parsed);
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

export function renderContratoHTML(templateSource: string, data: Record<string, unknown>): string {
  if (!helpersRegistered) {
    registerHandlebarsHelpers();
    helpersRegistered = true;
  }
  const template = Handlebars.compile(templateSource, { noEscape: true });
  return template(data);
}
