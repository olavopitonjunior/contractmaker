/**
 * Guarda de entitlement do revisor pós-geração — molde de lib/ingestion/guard.ts.
 *
 * Diferente da ingestão (transversal), a revisão sabe o `Deal.kind` no ponto de
 * disparo: a feature checada é a do módulo correspondente. `getOrgModules` só
 * liga uma feature com o módulo dela ligado, então esta checagem já contém o
 * guard de módulo.
 *
 * Sem camada de papel: o disparo é interno (hook da geração + cron), nunca uma
 * ação de usuário — quem gera contrato já passou pelos guards da rota de
 * geração.
 */

import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { proposalReviewFeatureForKind, reviewFeatureForDealKind } from "@/lib/modules/catalog";

export async function isContractReviewEnabled(
  orgId: string,
  dealKind: string
): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return isFeatureEnabled(view, reviewFeatureForDealKind(dealKind));
}

export async function isProposalReviewEnabled(
  orgId: string,
  proposalKind: string
): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return isFeatureEnabled(view, proposalReviewFeatureForKind(proposalKind));
}
