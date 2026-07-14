import type { ContractTemplate } from "@prisma/client";

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
 * Seleção determinística do template de proposta. Match EXATO por modalidade +
 * preferência por `isDefault`. Sem fallback: se a org não tem template ativo da
 * modalidade, retorna null e o caller orienta a rodar sync-templates.ts --seed.
 * Mesmo contrato de `selectAdministracaoTemplate`.
 */
export async function selectPropostaTemplate(
  orgId: string,
  schemaType: string
): Promise<{ template: ContractTemplate } | null> {
  const modalidade = propostaModalidadeForSchema(schemaType);
  if (!modalidade) return null;
  const { prisma } = await import("@/lib/db/prisma");
  const exact = await prisma.contractTemplate.findMany({
    where: { orgId, status: "active", modalidade },
  });
  if (exact.length === 0) return null;
  return { template: exact.find((t) => t.isDefault) ?? exact[0] };
}
