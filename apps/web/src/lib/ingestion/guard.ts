/**
 * Guarda de acesso do pipeline de ingestão em lote.
 *
 * Duas camadas, na ordem em que as rotas as aplicam:
 *
 * 1. **Papel** — owner/admin. Ingerir o acervo cria templates e cláusulas para
 *    a imobiliária inteira; não é operação de corretor.
 * 2. **Entitlement** — ao menos uma das features de ingestão ligada. A ingestão
 *    é transversal (o mesmo lote traz contrato de locação e CCV de venda), então
 *    basta o módulo que a imobiliária de fato usa. E como `getOrgModules` só
 *    liga uma feature se o MÓDULO dela estiver ligado, esta checagem já contém
 *    o guard de módulo — não há caminho em que a feature passe e o módulo não.
 */

import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { INGESTION_FEATURES } from "@/lib/modules/catalog";

/** Espelha o contrato de `ModuleDisabledError`: as rotas devolvem 403. */
export class IngestionDisabledError extends Error {
  readonly status = 403 as const;
  readonly code = "INGESTION_DISABLED" as const;
  constructor() {
    super("Ingestão de acervo em lote não está habilitada para esta imobiliária.");
    this.name = "IngestionDisabledError";
  }
}

export async function isIngestionEnabled(orgId: string): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return INGESTION_FEATURES.some((f) => isFeatureEnabled(view, f));
}

export async function assertIngestionEnabled(orgId: string): Promise<void> {
  if (!(await isIngestionEnabled(orgId))) throw new IngestionDisabledError();
}
