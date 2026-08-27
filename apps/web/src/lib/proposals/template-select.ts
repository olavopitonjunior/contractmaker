import type { ContractTemplate } from "@prisma/client";
import {
  deriveTemplateFacts,
  garantiaMatchedForFacts,
  pickTemplateByFacts,
} from "@/lib/contracts/template-category";

/**
 * Modalidade do template de proposta por schemaType. São três, deliberadamente
 * distintas de qualquer modalidade de contrato — a proposta é um instrumento
 * próprio (oferta), não o CCV/contrato de locação.
 *
 * Locação comercial ≠ residencial: termos próprios (destinação/ramo, luvas,
 * ação renovatória arts. 51-57), por isso template próprio.
 */
export const PROPOSTA_MODALIDADE_BY_SCHEMA: Record<string, string> = {
  compra_venda_v1: "proposta_venda",
  locacao_residencial_v1: "proposta_locacao_residencial",
  locacao_comercial_v1: "proposta_locacao_comercial",
};

export function propostaModalidadeForSchema(schemaType: string): string | null {
  return PROPOSTA_MODALIDADE_BY_SCHEMA[schemaType] ?? null;
}

/**
 * Seleção determinística do template de proposta. Match EXATO por modalidade;
 * dentro dela, as ESCOLHAS DA PROPOSTA (garantia, fiador PF/PJ, proponente
 * PF/PJ) escolhem a variante via `matchCriteria` e o empate prefere `isDefault`
 * — org sem variante marcada tem o comportamento de antes. Sem fallback de
 * modalidade: se a org não tem template ativo da modalidade, retorna null e o
 * caller orienta a ativar um modelo em /templates (o canônico é semeado na
 * criação do tenant por `seedCanonicalTemplatesForOrg`). Mesmo contrato de
 * `selectAdministracaoTemplate`.
 *
 * A página de proposta coleta `tipo_pessoa` das partes e, em locação,
 * `garantia.tipo` + fiador PF/PJ — é daí que saem os fatos. Proposta antiga (sem
 * esses campos) tem fatos nulos e cai no `isDefault`, como antes.
 */
export async function selectPropostaTemplate(
  orgId: string,
  schemaType: string,
  dataJson?: unknown
): Promise<{ template: ContractTemplate; garantiaMatched: boolean } | null> {
  const modalidade = propostaModalidadeForSchema(schemaType);
  if (!modalidade) return null;
  const { prisma } = await import("@/lib/db/prisma");
  const exact = await prisma.contractTemplate.findMany({
    where: { orgId, status: "active", modalidade },
  });
  if (exact.length === 0) return null;
  const facts = deriveTemplateFacts(dataJson);
  const template = pickTemplateByFacts(exact, facts);
  return {
    template,
    // D16: o fallback pra outra garantia deixa de ser silencioso — o caller
    // decide se avisa (nunca bloqueia).
    garantiaMatched: garantiaMatchedForFacts(template.matchCriteria, facts),
  };
}
