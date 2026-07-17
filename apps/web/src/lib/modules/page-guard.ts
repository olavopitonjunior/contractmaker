import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getOrgModules, isModuleEnabled, isFeatureEnabled } from "./read";
import type { ModuleKey, FeatureKey } from "./catalog";

/**
 * Guards server-side de PÁGINA/LAYOUT para módulos/sub-funções por tenant.
 *
 * Espelham `assertModuleEnabled`/`assertFeatureEnabled` (guard de API, lib/modules/guard.ts)
 * e o layout de locação (app/(dashboard)/locacao/layout.tsx). O middleware é edge e
 * NÃO lê módulos — o bloqueio por entitlement acontece aqui, no server component.
 *
 * Em falta de sessão redireciona pra /login; sem org ou módulo/feature desabilitado
 * redireciona pro `fallback` (default /pipeline, espelhando o layout de locação).
 * Retornam { userId, orgId } pro call-site reusar sem reconsultar.
 */
export async function requireModulePage(
  module: ModuleKey,
  fallback = "/pipeline",
): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Org do SUBDOMÍNIO navegado (não "primeira membership") — sem o hint,
  // usuário multi-org via os dados do tenant errado sob o branding do certo.
  const org = await getUserOrg(session.user.id, {
    subdomainHint: headers().get("x-org-subdomain"),
  });
  if (!org) redirect(fallback);
  const view = await getOrgModules(org.id);
  if (!isModuleEnabled(view, module)) redirect(fallback);
  return { userId: session.user.id, orgId: org.id };
}

export async function requireFeaturePage(
  feature: FeatureKey,
  fallback = "/pipeline",
): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Org do SUBDOMÍNIO navegado (não "primeira membership") — sem o hint,
  // usuário multi-org via os dados do tenant errado sob o branding do certo.
  const org = await getUserOrg(session.user.id, {
    subdomainHint: headers().get("x-org-subdomain"),
  });
  if (!org) redirect(fallback);
  const view = await getOrgModules(org.id);
  if (!isFeatureEnabled(view, feature)) redirect(fallback);
  return { userId: session.user.id, orgId: org.id };
}

/**
 * Como `requireFeaturePage`, mas passa se QUALQUER uma das features estiver
 * ligada (anyOf). Devolve também quais estão ligadas — a tela de Propostas usa
 * pra decidir se mostra o segmented control Vendas/Locação.
 */
export async function requireAnyFeaturePage(
  features: readonly FeatureKey[],
  fallback = "/pipeline",
): Promise<{ userId: string; orgId: string; enabled: Record<string, boolean> }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Org do SUBDOMÍNIO navegado (não "primeira membership") — sem o hint,
  // usuário multi-org via os dados do tenant errado sob o branding do certo.
  const org = await getUserOrg(session.user.id, {
    subdomainHint: headers().get("x-org-subdomain"),
  });
  if (!org) redirect(fallback);
  const view = await getOrgModules(org.id);
  const enabled: Record<string, boolean> = {};
  for (const f of features) enabled[f] = isFeatureEnabled(view, f);
  if (!features.some((f) => enabled[f])) redirect(fallback);
  return { userId: session.user.id, orgId: org.id, enabled };
}
