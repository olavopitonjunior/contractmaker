import fs from 'fs';
import Handlebars from 'handlebars';
import { registerHandlebarsHelpers } from '../helpers/handlebars';
import { DadosContrato } from '../types/contract';

let helpersRegistered = false;

function ensureHelpers(): void {
  if (!helpersRegistered) {
    registerHandlebarsHelpers();
    helpersRegistered = true;
  }
}

export function renderContratoHTML(templatePath: string, dados: DadosContrato): string {
  ensureHelpers();
  const source = fs.readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(source, { noEscape: true });
  return template(dados);
}

export function renderContratoHTMLFromString(templateSource: string, dados: DadosContrato): string {
  ensureHelpers();
  const template = Handlebars.compile(templateSource, { noEscape: true });
  return template(dados);
}
