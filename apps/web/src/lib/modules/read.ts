import { cache as reactCache } from "react";
import { prisma } from "@/lib/db/prisma";

// `React.cache` deduplica por request no runtime do Next (Server Components / route
// handlers). Fora dele (ex.: vitest com react stable que não exporta `cache`),
// degrada para identidade — sem memoização, comportamento correto.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === "function" ? reactCache : (fn) => fn;
import {
  MODULE_CATALOG,
  ALL_FEATURES,
  featureDefault,
  featureModule,
  isValidFeature,
  type ModuleKey,
  type FeatureKey,
} from "./catalog";

/**
 * Visão resolvida dos entitlements de uma org: já com os defaults do catálogo
 * aplicados sobre os overrides persistidos em `OrgModule.featureFlags`.
 */
export interface OrgModulesView {
  enabled: Record<ModuleKey, boolean>;
  features: Record<FeatureKey, boolean>;
}

/**
 * Lê os módulos habilitados de uma org e resolve as sub-funções contra o catálogo.
 *
 * - Cacheado por request (`React.cache`) — múltiplas chamadas no mesmo request batem
 *   uma vez só no banco. Um toggle no painel reflete no PRÓXIMO request (aceitável).
 * - FAIL-OPEN: módulo sem row no banco assume os defaults do catálogo (ambos habilitados
 *   por padrão). Preserva orgs entre a migration (P1) e o enforcement (P4), e nunca
 *   derruba uma superfície por falta de dado.
 * - Uma feature só está ON se o MÓDULO dela está habilitado E (override === true OU,
 *   na ausência de override, o default do catálogo é true).
 */
export const getOrgModules = cache(async (orgId: string): Promise<OrgModulesView> => {
  const rows = await prisma.orgModule.findMany({
    where: { orgId },
    select: { module: true, enabled: true, featureFlags: true },
  });

  const rowByModule = new Map(rows.map((r) => [r.module, r]));

  const enabled = {} as Record<ModuleKey, boolean>;
  for (const mod of MODULE_CATALOG) {
    const row = rowByModule.get(mod.key);
    // Sem row => fail-open (true). Com row => respeita `enabled`.
    enabled[mod.key] = row ? row.enabled : true;
  }

  const features = {} as Record<FeatureKey, boolean>;
  for (const feature of ALL_FEATURES) {
    const mod = featureModule(feature);
    if (!enabled[mod]) {
      features[feature] = false;
      continue;
    }
    const row = rowByModule.get(mod);
    const overrides = readFlags(row?.featureFlags);
    const override = overrides[feature];
    features[feature] = typeof override === "boolean" ? override : featureDefault(feature);
  }

  return { enabled, features };
});

export function isModuleEnabled(view: OrgModulesView, module: ModuleKey): boolean {
  return view.enabled[module] === true;
}

export function isFeatureEnabled(view: OrgModulesView, feature: FeatureKey): boolean {
  return view.features[feature] === true;
}

/** Normaliza o Json de overrides, ignorando chaves que não são features válidas. */
function readFlags(raw: unknown): Partial<Record<FeatureKey, boolean>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<FeatureKey, boolean>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean" && isValidFeature(k)) {
      out[k as FeatureKey] = v;
    }
  }
  return out;
}
