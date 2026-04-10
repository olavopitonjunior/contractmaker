import { ModeloAnalise } from '../analysis/types';

export interface TemplateGenerationResult {
  template: string;
  warnings: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pluralize(entity: string): string {
  if (entity.endsWith('s')) return entity;
  return `${entity}s`;
}

export function generateTemplateHandlebars(html: string, analysis: ModeloAnalise): TemplateGenerationResult {
  let template = html;
  const warnings: string[] = [];

  for (const campo of analysis.campos) {
    const variable = `{{${campo.sugestao_formulario}}}`;
    const regex = new RegExp(escapeRegExp(campo.padrao_encontrado), 'g');
    const before = template;
    template = template.replace(regex, variable);
    if (before === template) {
      warnings.push(`Campo nao encontrado para substituir: ${campo.padrao_encontrado}`);
    }
  }

  for (const cond of analysis.condicionais) {
    if (!cond.texto.trim()) continue;
    const regex = new RegExp(escapeRegExp(cond.texto.trim()));
    if (regex.test(template)) {
      template = template.replace(regex, `{{#if ${cond.condicao_sugerida}}}${cond.texto.trim()}{{/if}}`);
    } else {
      warnings.push(`Condicional nao encontrada para envolver: ${cond.id}`);
    }
  }

  for (const rep of analysis.repetiveis) {
    if (!rep.texto_exemplo.trim()) continue;
    const regex = new RegExp(escapeRegExp(rep.texto_exemplo.trim()));
    if (regex.test(template)) {
      const eachTarget = pluralize(rep.entidade);
      template = template.replace(regex, `{{#each ${eachTarget}}}${rep.texto_exemplo.trim()}{{/each}}`);
    } else {
      warnings.push(`Bloco repetivel nao encontrado para envolver: ${rep.id}`);
    }
  }

  return { template, warnings };
}
