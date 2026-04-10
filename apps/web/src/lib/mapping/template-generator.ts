import { ModeloAnalise } from '../analysis/heuristics';

export function generateTemplateHandlebars(html: string, analysis: ModeloAnalise): { template: string; warnings: string[] } {
  let template = html;
  const warnings: string[] = [];

  for (const campo of analysis.campos) {
    const variable = `{{${campo.sugestao_formulario}}}`;
    const regex = new RegExp(campo.padrao_encontrado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const before = template;
    template = template.replace(regex, variable);
    if (before === template) {
      warnings.push(`Campo nao encontrado para substituir: ${campo.padrao_encontrado}`);
    }
  }

  for (const cond of analysis.condicionais) {
    if (!cond.texto.trim()) continue;
    const regex = new RegExp(cond.texto.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (regex.test(template)) {
      template = template.replace(regex, `{{#if ${cond.condicao_sugerida}}}${cond.texto.trim()}{{/if}}`);
    } else {
      warnings.push(`Condicional nao encontrada para envolver: ${cond.id}`);
    }
  }

  for (const rep of analysis.repetiveis) {
    if (!rep.texto_exemplo.trim()) continue;
    const regex = new RegExp(rep.texto_exemplo.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (regex.test(template)) {
      const eachTarget = rep.entidade.endsWith('s') ? rep.entidade : `${rep.entidade}s`;
      template = template.replace(regex, `{{#each ${eachTarget}}}${rep.texto_exemplo.trim()}{{/each}}`);
    } else {
      warnings.push(`Bloco repetivel nao encontrado para envolver: ${rep.id}`);
    }
  }

  return { template, warnings };
}
