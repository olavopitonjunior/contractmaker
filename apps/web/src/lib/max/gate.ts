import { NextResponse } from "next/server";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE, maxFeatureForDealKind } from "@/lib/modules/catalog";

/**
 * Entitlement do Max (agente de WhatsApp dos tenants RE/MAX) por tenant.
 *
 * Espelha `lib/newton/gate.ts` de propósito: a decisão "qual agente atende este
 * tenant" é de configuração, não de código, e ter as duas leituras com a mesma
 * forma deixa o roteador (`lib/agents/whatsapp-router.ts`) trivial de auditar.
 *
 * Ambas as features nascem **default OFF** — um tenant só passa a falar com o
 * Max quando alguém liga no painel super-admin, o que faz do rollout um flip por
 * org, sem deploy.
 */

/** O tenant tem o Max em ALGUM módulo? (usado onde o kind do deal não é conhecido) */
export async function isMaxEnabledForOrg(orgId: string): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return (
    isFeatureEnabled(view, FEATURE.VENDAS_MAX) ||
    isFeatureEnabled(view, FEATURE.LOCACAO_MAX)
  );
}

/** O tenant tem o Max pro tipo de negócio em questão? */
export async function isMaxEnabledForDeal(
  orgId: string,
  dealKind: string
): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return isFeatureEnabled(view, maxFeatureForDealKind(dealKind));
}

const DISABLED_BODY = {
  error: "MODULE_DISABLED",
  message: "O Max não está habilitado para esta organização.",
};

/**
 * 403 pronto quando o Max está desligado, ou `null` pra seguir.
 * Mesmo contrato do `ModuleDisabledError` (code MODULE_DISABLED, status 403).
 */
export async function maxDisabledResponse(
  orgId: string,
  dealKind?: string
): Promise<NextResponse | null> {
  const enabled = dealKind
    ? await isMaxEnabledForDeal(orgId, dealKind)
    : await isMaxEnabledForOrg(orgId);
  return enabled ? null : NextResponse.json(DISABLED_BODY, { status: 403 });
}
