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

/**
 * Gate das rotas do plano de agente (`/api/agents/*`) quando quem chama é o Max.
 *
 * Sem isto o entitlement é meia-verdade: as features `vendas.max`/`locacao.max`
 * controlam o ImobPro **falar** com o Max (`lib/max/notify-trigger.ts`), mas não
 * o Max **ler** o tenant. Um token válido continuava lendo persona, base de
 * conhecimento e gravando custo numa org que nunca ligou o agente — ou que
 * desligou.
 *
 * Duas restrições que não são detalhe:
 *
 * - **Só `via === "bearer"`.** As mesmas rotas servem a UI (`/settings/ai-agents`,
 *   `/admin/agents`), e o operador precisa conseguir ver e editar a configuração
 *   do Max justamente para decidir se liga a feature. Gatear a sessão criaria um
 *   ovo-e-galinha na própria tela que resolve o problema.
 * - **Só `agentKey === "max"`.** A rota é compartilhada com qualquer agente
 *   externo do registry; um agente futuro teria o próprio entitlement, e herdar
 *   o do Max o desligaria em silêncio.
 *
 * **403 aqui, e não 200 como o `enabled: false` do perfil.** São coisas
 * diferentes: `enabled` é kill switch operacional dentro de um tenant que USA o
 * Max (por isso responde 200, para o agente distinguir "desligado de propósito"
 * de "não consegui ler"); isto é "esta imobiliária não contratou o agente" — não
 * há configuração a devolver, e o código `MODULE_DISABLED` no corpo diz
 * exatamente qual das duas é.
 */
export async function maxAgentRouteGate(params: {
  orgId: string;
  via: "session" | "bearer";
  agentKey: string;
}): Promise<NextResponse | null> {
  if (params.via !== "bearer" || params.agentKey !== "max") return null;
  return maxDisabledResponse(params.orgId);
}
