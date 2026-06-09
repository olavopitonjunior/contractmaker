import { getOrgModules, isModuleEnabled, isFeatureEnabled } from "./read";
import { featureModule, type ModuleKey, type FeatureKey } from "./catalog";

/**
 * Lançado quando uma org tenta acessar um módulo/sub-função que não tem habilitado.
 * Espelha o contrato de `PermissionDeniedError` (lib/security/rbac/guard.ts): os route
 * handlers capturam pelo `code`/`status` e devolvem 403.
 */
export class ModuleDisabledError extends Error {
  readonly status = 403;
  readonly code = "MODULE_DISABLED";
  readonly module: ModuleKey;
  readonly feature?: FeatureKey;

  constructor(module: ModuleKey, feature?: FeatureKey) {
    super(
      feature
        ? `Sub-função "${feature}" indisponível: módulo "${module}" não habilitado para esta organização.`
        : `Módulo "${module}" não habilitado para esta organização.`,
    );
    this.name = "ModuleDisabledError";
    this.module = module;
    this.feature = feature;
  }
}

/** Garante que a org tem o módulo habilitado; senão lança ModuleDisabledError (403). */
export async function assertModuleEnabled(orgId: string, module: ModuleKey): Promise<void> {
  const view = await getOrgModules(orgId);
  if (!isModuleEnabled(view, module)) {
    throw new ModuleDisabledError(module);
  }
}

/**
 * Garante que a org tem a sub-função habilitada (implica módulo habilitado);
 * senão lança ModuleDisabledError (403).
 */
export async function assertFeatureEnabled(orgId: string, feature: FeatureKey): Promise<void> {
  const view = await getOrgModules(orgId);
  if (!isFeatureEnabled(view, feature)) {
    throw new ModuleDisabledError(featureModule(feature), feature);
  }
}
