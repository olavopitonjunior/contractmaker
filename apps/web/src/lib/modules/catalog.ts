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
  VENDAS_NEWTON: "vendas.newton",
  VENDAS_MAX: "vendas.max",
  VENDAS_PROPOSTAS: "vendas.propostas",
  VENDAS_PESQUISAS: "vendas.pesquisas",
  VENDAS_INGESTAO_ACERVO: "vendas.ingestao_acervo",
  VENDAS_REVISAO_CONTRATO: "vendas.revisao_contrato",
  VENDAS_REVISAO_PROPOSTA: "vendas.revisao_proposta",

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
  LOCACAO_NEWTON: "locacao.newton",
  LOCACAO_MAX: "locacao.max",
  LOCACAO_PROPOSTAS: "locacao.propostas",
  LOCACAO_PESQUISAS: "locacao.pesquisas",
  LOCACAO_INGESTAO_ACERVO: "locacao.ingestao_acervo",
  LOCACAO_REVISAO_CONTRATO: "locacao.revisao_contrato",
  LOCACAO_REVISAO_PROPOSTA: "locacao.revisao_proposta",
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
      // Default OFF desde 2026-08-20: menu Financeiro + settings de pagamentos
      // escondidos de todos os tenants; religar por tenant no painel super-admin.
      // O MOTOR não é gateado por esta flag (crons/webhooks/aba de cobrança do
      // deal seguem funcionando) — só navegação e páginas de settings.
      { key: FEATURE.VENDAS_PAGADORIA, label: "Pagadoria / comissão", default: false },
      { key: FEATURE.VENDAS_NEWTON, label: "Newton (agente WhatsApp) — vendas", default: false },
      { key: FEATURE.VENDAS_MAX, label: "Max (agente WhatsApp) — vendas", default: false },
      { key: FEATURE.VENDAS_PROPOSTAS, label: "Propostas — vendas", default: true },
      { key: FEATURE.VENDAS_PESQUISAS, label: "Pesquisas de satisfação — vendas", default: true },
      // Pipeline de ingestão em lote do acervo (a imobiliária joga os modelos
      // todos de uma vez e o servidor monta a biblioteca). Default OFF: o
      // pipeline gasta OCR e IA por arquivo, então entra tenant a tenant.
      {
        key: FEATURE.VENDAS_INGESTAO_ACERVO,
        label: "Ingestão de acervo em lote — vendas",
        default: false,
      },
      // Revisor pós-geração de contrato (Workstream B): confere o documento
      // gerado contra o plano de geração + dados do form e aponta divergências
      // como ContractComment (só avisa, nunca trava /approve). ON por padrão
      // (decisão do dono, 28/08/2026, mesma lógica da ingestão): suggest-only
      // com cap de custo diário por org (CONTRACT_REVIEW_DAILY_MAX_USD).
      {
        key: FEATURE.VENDAS_REVISAO_CONTRATO,
        label: "Revisão pós-geração de contrato — vendas",
        default: true,
      },
      // Revisão pós-ENVIO de proposta (3º ciclo do WS B): roda sobre o
      // snapshot congelado no envio; achado vira evento na timeline da
      // proposta (registro de auditoria — nunca gate). Chave própria para o
      // tenant poder desligar proposta sem desligar contrato.
      {
        key: FEATURE.VENDAS_REVISAO_PROPOSTA,
        label: "Revisão pós-envio de proposta — vendas",
        default: true,
      },
    ],
  },
  {
    key: MODULE.LOCACAO,
    label: "Locação",
    features: [
      { key: FEATURE.LOCACAO_PIPELINE, label: "Pipeline de locação", default: true },
      // Default OFF desde 2026-08-20: escondido de todos os tenants em produção;
      // religar por tenant via painel super-admin (/admin/orgs/[orgId]/modules).
      { key: FEATURE.LOCACAO_ADM, label: "ADM Locação (menu)", default: false },
      { key: FEATURE.LOCACAO_CONTRATOS, label: "ADM — contratos", default: true },
      { key: FEATURE.LOCACAO_COBRANCAS, label: "ADM — cobranças", default: false },
      { key: FEATURE.LOCACAO_REPASSES, label: "ADM — repasses", default: false },
      { key: FEATURE.LOCACAO_DESPESAS, label: "ADM — despesas", default: false },
      { key: FEATURE.LOCACAO_VISTORIAS, label: "Vistorias", default: false },
      { key: FEATURE.LOCACAO_SEGUROS, label: "Seguros", default: false },
      { key: FEATURE.LOCACAO_PESSOAS, label: "Pessoas", default: true },
      { key: FEATURE.LOCACAO_NEWTON, label: "Newton (agente WhatsApp) — locação", default: false },
      { key: FEATURE.LOCACAO_MAX, label: "Max (agente WhatsApp) — locação", default: false },
      { key: FEATURE.LOCACAO_PROPOSTAS, label: "Propostas — locação", default: true },
      { key: FEATURE.LOCACAO_PESQUISAS, label: "Pesquisas de satisfação — locação", default: true },
      {
        key: FEATURE.LOCACAO_INGESTAO_ACERVO,
        label: "Ingestão de acervo em lote — locação",
        // ON por padrão desde a entrega da Ativa (27/08/2026): é o caminho
        // padrão de onboarding. Suggest-only + cap de custo por lote — nada
        // nasce ativo e nenhum tenant paga análise sem subir arquivos.
        default: true,
      },
      // Revisor pós-geração — mesma feature do lado locação (ver o comentário
      // na chave de vendas).
      {
        key: FEATURE.LOCACAO_REVISAO_CONTRATO,
        label: "Revisão pós-geração de contrato — locação",
        default: true,
      },
      {
        key: FEATURE.LOCACAO_REVISAO_PROPOSTA,
        label: "Revisão pós-envio de proposta — locação",
        default: true,
      },
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

/**
 * Feature do Newton correspondente à natureza do negócio.
 *
 * O Newton (agente de WhatsApp) é transversal: o inbox de pedidos vive sob ADM Locação,
 * mas a aba "Pedidos" aparece em deals de venda E de locação. Como toda feature do
 * catálogo pertence a exatamente um módulo (`featureModule` lança se não pertencer),
 * existe uma chave por módulo e este helper escolhe a certa pelo `Deal.kind`.
 *
 * Default OFF nas duas: tenants novos não nascem com o Newton (as RE/MAX usam outro
 * agente). Quem quiser liga no painel super-admin.
 */
export function newtonFeatureForDealKind(kind: string): FeatureKey {
  return kind === "locacao" ? FEATURE.LOCACAO_NEWTON : FEATURE.VENDAS_NEWTON;
}

/**
 * Feature do Max — o outro agente de WhatsApp, dos tenants RE/MAX.
 *
 * Mesma forma do Newton (uma chave por módulo, default OFF), porque a escolha é
 * por TENANT e não por instalação: o Newton roda em OpenClaw com número pareado
 * por QR, o Max em serviço próprio com gateway e número próprios. Um tenant
 * tem um ou outro; ligar os dois no mesmo módulo é configuração inválida, e quem
 * resolve o empate é `resolveWhatsappAgent` (lib/agents/whatsapp-router.ts), que
 * dá precedência ao Max.
 */
export function maxFeatureForDealKind(kind: string): FeatureKey {
  return kind === "locacao" ? FEATURE.LOCACAO_MAX : FEATURE.VENDAS_MAX;
}

/** Feature de Propostas por kind. Default ON nos dois desde 2026-07-24 (graduou do
 *  rollout gradual — PR #166 estabilizou a rodada-2). Org pode desligar via override. */
export function proposalFeatureForKind(kind: string): FeatureKey {
  return kind === "locacao" ? FEATURE.LOCACAO_PROPOSTAS : FEATURE.VENDAS_PROPOSTAS;
}

/** Feature de Pesquisas de satisfação por kind (transversal, como o Newton).
 *  Default ON nas duas desde 2026-07-24 (validada em staging + prod; PRs
 *  #172/#179/#180). Org pode desligar via override. O CANAL WhatsApp continua
 *  gateado pela feature do Newton (default OFF) — sem Newton, cai pra email. */
export function surveyFeatureForKind(kind: string): FeatureKey {
  return kind === "locacao" ? FEATURE.LOCACAO_PESQUISAS : FEATURE.VENDAS_PESQUISAS;
}

/**
 * Features da ingestão de acervo em lote — uma por módulo, como o Newton e as
 * Propostas.
 *
 * A ingestão é TRANSVERSAL (o mesmo lote traz contrato de locação e CCV de
 * venda) mas toda feature do catálogo pertence a exatamente um módulo. Então
 * existe uma chave por módulo e a Central exige ao menos uma delas ligada — ver
 * `lib/ingestion/guard.ts`.
 */
export const INGESTION_FEATURES: readonly FeatureKey[] = [
  FEATURE.VENDAS_INGESTAO_ACERVO,
  FEATURE.LOCACAO_INGESTAO_ACERVO,
];

/**
 * Feature do revisor pós-geração por `Deal.kind` — uma chave por módulo, como
 * o Newton/Propostas. A revisão é disparada pelo hook da geração, que já sabe
 * o kind do deal; não há caso transversal como o da ingestão.
 */
export function reviewFeatureForDealKind(kind: string): FeatureKey {
  return kind === "locacao"
    ? FEATURE.LOCACAO_REVISAO_CONTRATO
    : FEATURE.VENDAS_REVISAO_CONTRATO;
}

/** Feature da revisão pós-envio de PROPOSTA por `Proposal.kind`. */
export function proposalReviewFeatureForKind(kind: string): FeatureKey {
  return kind === "locacao"
    ? FEATURE.LOCACAO_REVISAO_PROPOSTA
    : FEATURE.VENDAS_REVISAO_PROPOSTA;
}

/** Definição completa de um módulo. */
export function moduleDef(module: ModuleKey): ModuleDef {
  const def = MODULE_CATALOG.find((m) => m.key === module);
  if (!def) {
    throw new Error(`Módulo desconhecido no catálogo: ${module}`);
  }
  return def;
}
