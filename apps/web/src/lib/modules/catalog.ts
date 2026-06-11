/**
 * Catálogo de módulos e sub-funções habilitáveis por tenant (org).
 *
 * SINGLE SOURCE OF TRUTH da modularização Vendas/Locação.
 *
 * Regras:
 * - Este arquivo é CLIENT-SAFE: não importar nada de servidor (Prisma, fs, etc.).
 *   A sidebar (client component) importa daqui.
 * - Os DEFAULTS das sub-funções moram AQUI (no código), nunca no banco. A coluna
 *   `OrgModule.featureFlags` é `@default("{}")`; a ausência de uma chave resolve
 *   para o default do catálogo em runtime (ver lib/modules/read.ts). Isso evita o
 *   gotcha de Json/array default drift (memória feedback_prisma_array_default_drift):
 *   adicionar uma nova sub-função = editar SÓ este arquivo, sem migração de dados.
 * - `OrgModule.module` referencia o catálogo POR STRING, validado em runtime via
 *   `isValidModule` — nunca FK.
 *
 * ATENÇÃO: a chave de módulo "vendas" NÃO é o `Pipeline.kind` (que é "venda",
 * singular). O mapeamento módulo→kind vive em lib/modules/resolve.ts.
 */

export const MODULE = {
  VENDAS: "vendas",
  LOCACAO: "locacao",
} as const;

export type ModuleKey = (typeof MODULE)[keyof typeof MODULE];

export const FEATURE = {
  // Módulo Vendas
  VENDAS_PIPELINE: "vendas.pipeline",
  VENDAS_FORM_PUBLICO: "vendas.form_publico",
  VENDAS_CERTIDOES: "vendas.certidoes",
  VENDAS_PAGADORIA: "vendas.pagadoria",

  // Módulo Locação
  LOCACAO_PIPELINE: "locacao.pipeline",
  LOCACAO_ADM: "locacao.adm",
  LOCACAO_CONTRATOS: "locacao.contratos",
  LOCACAO_COBRANCAS: "locacao.cobrancas",
  LOCACAO_REPASSES: "locacao.repasses",
  LOCACAO_DESPESAS: "locacao.despesas",
  LOCACAO_VISTORIAS: "locacao.vistorias",
  LOCACAO_SEGUROS: "locacao.seguros",
  LOCACAO_PESSOAS: "locacao.pessoas",
} as const;

export type FeatureKey = (typeof FEATURE)[keyof typeof FEATURE];

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  /** Default quando a org tem o módulo mas a flag não está explícita. */
  default: boolean;
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  features: readonly FeatureDef[];
}

export const MODULE_CATALOG: readonly ModuleDef[] = [
  {
    key: MODULE.VENDAS,
    label: "Vendas",
    features: [
      { key: FEATURE.VENDAS_PIPELINE, label: "Pipeline de vendas", default: true },
      { key: FEATURE.VENDAS_FORM_PUBLICO, label: "Formulário público", default: true },
      { key: FEATURE.VENDAS_CERTIDOES, label: "Certidões", default: true },
      { key: FEATURE.VENDAS_PAGADORIA, label: "Pagadoria / comissão", default: true },
    ],
  },
  {
    key: MODULE.LOCACAO,
    label: "Locação",
    features: [
      { key: FEATURE.LOCACAO_PIPELINE, label: "Pipeline de locação", default: true },
      { key: FEATURE.LOCACAO_ADM, label: "ADM Locação (menu)", default: true },
      { key: FEATURE.LOCACAO_CONTRATOS, label: "ADM — contratos", default: true },
      { key: FEATURE.LOCACAO_COBRANCAS, label: "ADM — cobranças", default: false },
      { key: FEATURE.LOCACAO_REPASSES, label: "ADM — repasses", default: false },
      { key: FEATURE.LOCACAO_DESPESAS, label: "ADM — despesas", default: false },
      { key: FEATURE.LOCACAO_VISTORIAS, label: "Vistorias", default: false },
      { key: FEATURE.LOCACAO_SEGUROS, label: "Seguros", default: false },
      { key: FEATURE.LOCACAO_PESSOAS, label: "Pessoas", default: true },
    ],
  },
] as const;

const MODULE_KEYS: readonly string[] = MODULE_CATALOG.map((m) => m.key);

const FEATURE_BY_KEY: ReadonlyMap<FeatureKey, FeatureDef> = new Map(
  MODULE_CATALOG.flatMap((m) => m.features.map((f) => [f.key, f] as const)),
);

const MODULE_BY_FEATURE: ReadonlyMap<FeatureKey, ModuleKey> = new Map(
  MODULE_CATALOG.flatMap((m) => m.features.map((f) => [f.key, m.key] as const)),
);

/** Lista plana de todas as features do catálogo. */
export const ALL_FEATURES: readonly FeatureKey[] = Array.from(FEATURE_BY_KEY.keys());

/** Valida se uma string é uma chave de módulo conhecida. */
export function isValidModule(value: string): value is ModuleKey {
  return MODULE_KEYS.includes(value);
}

/** Valida se uma string é uma chave de feature conhecida. */
export function isValidFeature(value: string): value is FeatureKey {
  return FEATURE_BY_KEY.has(value as FeatureKey);
}

/** Módulo ao qual uma feature pertence. */
export function featureModule(feature: FeatureKey): ModuleKey {
  const mod = MODULE_BY_FEATURE.get(feature);
  if (!mod) {
    throw new Error(`Feature desconhecida no catálogo: ${feature}`);
  }
  return mod;
}

/** Default do catálogo para uma feature (usado quando a flag não está explícita). */
export function featureDefault(feature: FeatureKey): boolean {
  return FEATURE_BY_KEY.get(feature)?.default ?? false;
}

/** Definição completa de um módulo. */
export function moduleDef(module: ModuleKey): ModuleDef {
  const def = MODULE_CATALOG.find((m) => m.key === module);
  if (!def) {
    throw new Error(`Módulo desconhecido no catálogo: ${module}`);
  }
  return def;
}
