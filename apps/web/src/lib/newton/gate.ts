import { NextResponse } from "next/server";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE, newtonFeatureForDealKind } from "@/lib/modules/catalog";

/**
 * Entitlement do Newton (agente de WhatsApp) por tenant.
 *
 * O Newton é transversal (venda + locação), então há uma feature por módulo —
 * `vendas.newton` e `locacao.newton`, ambas **default OFF**. Um tenant que não usa
 * o Newton (as RE/MAX têm outro agente) não deve ver a aba de pedidos, não deve ter
 * inbox, e não deve conseguir cutucar o sidecar de WhatsApp por API.
 */

/** O tenant tem o Newton em ALGUM módulo? (usado onde o kind do deal não é conhecido) */
export async function isNewtonEnabledForOrg(orgId: string): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return (
    isFeatureEnabled(view, FEATURE.VENDAS_NEWTON) ||
    isFeatureEnabled(view, FEATURE.LOCACAO_NEWTON)
  );
}

/** O tenant tem o Newton pro tipo de negócio em questão? */
export async function isNewtonEnabledForDeal(orgId: string, dealKind: string): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return isFeatureEnabled(view, newtonFeatureForDealKind(dealKind));
}

const DISABLED_BODY = {
  error: "MODULE_DISABLED",
  message: "O Newton não está habilitado para esta organização.",
};

/**
 * 403 pronto quando o Newton está desligado, ou `null` pra seguir.
 * Espelha o contrato do `ModuleDisabledError` (code MODULE_DISABLED, status 403) sem
 * obrigar cada rota a montar o try/catch.
 */
export async function newtonDisabledResponse(
  orgId: string,
  dealKind?: string
): Promise<NextResponse | null> {
  const enabled = dealKind
    ? await isNewtonEnabledForDeal(orgId, dealKind)
    : await isNewtonEnabledForOrg(orgId);
  return enabled ? null : NextResponse.json(DISABLED_BODY, { status: 403 });
}
