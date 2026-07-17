import { redirect } from "next/navigation";
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
 *
 * NOTA (multi-org / subdomínio): resolve por "primeira membership", SEM
 * subdomainHint. O app hoje é MISTO: o layout do dashboard e o context das
 * APIs usam o hint, mas estes guards, o layout de locação e as páginas
 * internas não — pra usuário multi-org, dado servido pode divergir do
 * branding. Consertar SÓ aqui provou criar split-brain (gate na org do
 * subdomínio, páginas na primeira membership) e loop de redirect com os
 * fallbacks hint-less. O fix é um SWEEP único (todos os call-sites de
 * getUserOrg juntos) — memória project_multiorg_subdomain_resolution.
 */
export async function requireModulePage(
  module: ModuleKey,
  fallback = "/pipeline",
): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
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
  const org = await getUserOrg(session.user.id);
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
  const org = await getUserOrg(session.user.id);
  if (!org) redirect(fallback);
  const view = await getOrgModules(org.id);
  const enabled: Record<string, boolean> = {};
  for (const f of features) enabled[f] = isFeatureEnabled(view, f);
  if (!features.some((f) => enabled[f])) redirect(fallback);
  return { userId: session.user.id, orgId: org.id, enabled };
}
