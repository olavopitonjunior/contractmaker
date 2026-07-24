import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import { ModuleDisabledError } from "@/lib/modules/guard";

/**
 * Templates/relatórios de pesquisa são compartilhados entre vendas e locação —
 * a org só precisa de UMA das sub-funções ligadas (anyOf). Operações escopadas
 * a um deal específico usam `assertFeatureEnabled(surveyFeatureForKind(kind))`.
 */
export async function assertAnySurveyFeature(orgId: string): Promise<void> {
  if (!(await isAnySurveyFeatureEnabled(orgId))) {
    throw new ModuleDisabledError("vendas", FEATURE.VENDAS_PESQUISAS);
  }
}

/** Versão booleana pros caminhos automáticos (dispatch/crons): desligar a
 *  feature TEM que parar disparos e reminders, não só esconder a UI. */
export async function isAnySurveyFeatureEnabled(orgId: string): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return (
    isFeatureEnabled(view, FEATURE.VENDAS_PESQUISAS) ||
    isFeatureEnabled(view, FEATURE.LOCACAO_PESQUISAS)
  );
}

/** Feature por kind do deal (dispatch automático). */
export async function isSurveyFeatureEnabledForKind(
  orgId: string,
  kind: string
): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return isFeatureEnabled(
    view,
    kind === "locacao" ? FEATURE.LOCACAO_PESQUISAS : FEATURE.VENDAS_PESQUISAS
  );
}
