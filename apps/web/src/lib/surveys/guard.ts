import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import { ModuleDisabledError } from "@/lib/modules/guard";

/**
 * Templates/relatórios de pesquisa são compartilhados entre vendas e locação —
 * a org só precisa de UMA das sub-funções ligadas (anyOf). Operações escopadas
 * a um deal específico usam `assertFeatureEnabled(surveyFeatureForKind(kind))`.
 */
export async function assertAnySurveyFeature(orgId: string): Promise<void> {
  const view = await getOrgModules(orgId);
  const vendas = isFeatureEnabled(view, FEATURE.VENDAS_PESQUISAS);
  const locacao = isFeatureEnabled(view, FEATURE.LOCACAO_PESQUISAS);
  if (!vendas && !locacao) {
    throw new ModuleDisabledError("vendas", FEATURE.VENDAS_PESQUISAS);
  }
}
