import Handlebars from 'handlebars';

function valorPorExtenso(valor: number): string {
  if (Number.isNaN(valor)) return '';
  return String(valor);
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
