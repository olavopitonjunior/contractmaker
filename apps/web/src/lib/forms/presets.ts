/**
 * Presets de campos obrigatórios por etapa do formulário público.
 *
 * Substitui o STEP_REQUIRED_FIELDS estático que vivia em `validation.ts`.
 * Cada preset é um `string[][]` indexado por step (7 etapas — DocumentosStep,
 * Vendedor, Comprador, Imovel, StatusDebitos (com Posse), Pagamento,
 * ComissaoConfig). Cada elemento é um path para `form.trigger` do RHF.
 * Atualizado 2026-05-16: 8→7 etapas (merge Posse/Título no Status/Débitos).
 *
 * Por que declarativo em código (não DB):
 * - Paths estão acoplados ao schema Zod em `validation.ts`. Renomeação de
 *   campo quebra TS aqui — desejável. Em DB, vira string órfã silenciosa.
 * - Type-safe e versionado junto com o schema.
 *
 * Override fino: `OrgFormSettings.customRequiredPaths` é union ADICIONAL
 * ao preset (não substitui). Útil quando admin marca campo opcional como
 * obrigatório sem mudar preset inteiro.
 *
 * Regras cross-field (cônjuge obrigatório se casado, soma % comissionados ≤
 * 100) ficam no `superRefine` de `validation.ts` e NÃO duplicam aqui.
 */

// Array idêntico ao STEP_REQUIRED_FIELDS hardcoded original.
// Default para orgs criadas antes de OrgFormSettings existir.
// NÃO MEXER neste array — mudanças aqui afetam orgs legadas.
const PRESET_LEGADO: readonly (readonly string[])[] = [
  [],
  ["vendedores"],
  ["compradores"],
  ["imoveis.0.rua", "imoveis.0.cidade", "imoveis.0.uf", "imoveis.0.descricao"],
  [],
  ["pagamento.valor_total"],
  [],
] as const;

// Mínimo viável: nome + identidade fiscal + valor + descrição imóvel.
const PRESET_MINIMO: readonly (readonly string[])[] = [
  [],
  ["vendedores"],
  ["compradores"],
  ["imoveis.0.descricao"],
  [],
  ["pagamento.valor_total"],
  [],
] as const;

// Padrão para orgs novas: + endereço completo das partes + estado_civil + email.
// A regra "cônjuge obrigatório se casado" vem do superRefine, não daqui.
// 2026-06-02 — `email` do titular passou a ser OBRIGATÓRIO (hard): é o que a
// ClickSign exige por signatário (sem e-mail, dealDataToSigners joga a parte em
// `missing` e ela não assina). Os campos de certidão (rg/nascimento/nome_mae/
// sexo) seguem como RECOMENDAÇÃO não-bloqueante — ver
// CERTIDAO_RECOMMENDED_PARTY_FIELDS em party-required.ts (guarda híbrida).
const PRESET_PADRAO: readonly (readonly string[])[] = [
  [],
  [
    "vendedores",
    "vendedores.0.cpf",
    "vendedores.0.estado_civil",
    "vendedores.0.email",
    "vendedores.0.endereco",
    "vendedores.0.cidade",
    "vendedores.0.uf",
  ],
  [
    "compradores",
    "compradores.0.cpf",
    "compradores.0.estado_civil",
    "compradores.0.email",
    "compradores.0.endereco",
    "compradores.0.cidade",
    "compradores.0.uf",
  ],
  ["imoveis.0.rua", "imoveis.0.cidade", "imoveis.0.uf", "imoveis.0.descricao"],
  [],
  ["pagamento.valor_total"],
  [],
] as const;

// Completo: + RG, data_nascimento, nome_mae, sexo, naturalidade.
// Necessários por TJSP/PGFN/Antecedentes PF (Phase H 2026-04-18).
// 2026-06-02 — `sexo` adicionado: TJSP pedido-certidao exige `genero` p/ PF
// (606 sem); sem ele a Certidão de Distribuição vira SkippedJob "complete o
// sexo". Ver sexoToGenero/planner.ts.
const PRESET_COMPLETO: readonly (readonly string[])[] = [
  [],
  [
    "vendedores",
    "vendedores.0.cpf",
    "vendedores.0.rg",
    "vendedores.0.data_nascimento",
    "vendedores.0.nome_mae",
    "vendedores.0.sexo",
    "vendedores.0.estado_civil",
    "vendedores.0.profissao",
    "vendedores.0.email",
    "vendedores.0.endereco",
    "vendedores.0.cidade",
    "vendedores.0.uf",
    "vendedores.0.cep",
  ],
  [
    "compradores",
    "compradores.0.cpf",
    "compradores.0.rg",
    "compradores.0.data_nascimento",
    "compradores.0.nome_mae",
    "compradores.0.sexo",
    "compradores.0.estado_civil",
    "compradores.0.profissao",
    "compradores.0.email",
    "compradores.0.endereco",
    "compradores.0.cidade",
    "compradores.0.uf",
    "compradores.0.cep",
  ],
  [
    "imoveis.0.rua",
    "imoveis.0.cidade",
    "imoveis.0.uf",
    "imoveis.0.cep",
    "imoveis.0.matricula",
    "imoveis.0.descricao",
  ],
  [],
  ["pagamento.valor_total"],
  [],
] as const;

export type FormPreset = "legado" | "minimo" | "padrao" | "completo" | "custom";

export const FORM_REQUIRED_PRESETS: Record<
  Exclude<FormPreset, "custom">,
  readonly (readonly string[])[]
> = {
  legado: PRESET_LEGADO,
  minimo: PRESET_MINIMO,
  padrao: PRESET_PADRAO,
  completo: PRESET_COMPLETO,
};

const TOTAL_STEPS = PRESET_LEGADO.length;

/**
 * Resolve a lista final de campos obrigatórios pra um step específico.
 *
 * preset "custom" usa apenas `customRequiredPaths` (sem base).
 * Outros presets fazem união preset + customRequiredPaths.
 *
 * `customRequiredPaths` é Json — esperamos `Array<{ step: number; path: string }>`.
 * Tudo mais (string órfã, shape errado) é silenciosamente ignorado pra não
 * derrubar form se algum admin salvar config malformada.
 */
export function resolveRequiredFields(
  settings: { preset: string; customRequiredPaths: unknown } | null,
  stepIndex: number,
): readonly string[] {
  if (stepIndex < 0 || stepIndex >= TOTAL_STEPS) return [];

  const preset = (settings?.preset ?? "legado") as FormPreset;
  const base =
    preset === "custom"
      ? []
      : (FORM_REQUIRED_PRESETS[preset] ?? FORM_REQUIRED_PRESETS.legado)[
          stepIndex
        ] ?? [];

  const customForStep = extractCustomPathsForStep(
    settings?.customRequiredPaths,
    stepIndex,
  );

  if (customForStep.length === 0) return base;

  const merged = new Set([...base, ...customForStep]);
  return Array.from(merged);
}

/**
 * Versão de conveniência que retorna o array completo (7 steps).
 * Usada server-side em `f/[token]/page.tsx` pra passar pro client de uma vez.
 */
export function resolveAllRequiredFields(
  settings: { preset: string; customRequiredPaths: unknown } | null,
): readonly (readonly string[])[] {
  return Array.from({ length: TOTAL_STEPS }, (_, i) =>
    resolveRequiredFields(settings, i),
  );
}

// -------------------------------------------------------------------
// Allowlist de paths obrigatóveis (validação de `customRequiredPaths`).
//
// Um path órfão (campo renomeado, typo do admin) era silenciosamente ignorado
// por extractCustomPathsForStep → virava "obrigatoriedade fantasma" que nunca
// dispara. A rota PATCH /api/org/form-settings valida cada path contra esta
// lista e recusa os desconhecidos. Índices de array são normalizados pra `0`.
//
// Acoplado ao schema Zod de validation.ts — renomear um campo lá exige atualizar
// aqui (mesmo princípio dos presets). Coberto por presets.test.ts.
// -------------------------------------------------------------------

// Campos escalares de uma parte (vendedor/comprador), formas PF + PJ.
const PARTY_FIELDS = [
  "nome", "razao_social", "cnpj", "cpf", "rg", "data_nascimento", "nome_mae",
  "sexo", "estado_civil", "profissao", "nacionalidade", "email", "mobile_phone",
  "endereco", "numero", "complemento", "bairro", "cidade", "uf", "cep",
] as const;

// Sub-pessoas da parte e seus campos requereáveis.
const PARTY_SUB_FIELDS = ["nome", "cpf", "rg", "data_nascimento", "nome_mae", "sexo", "email", "mobile_phone"] as const;
const PARTY_SUBS = ["conjuge", "procurador", "representante"] as const;

const IMOVEL_FIELDS = [
  "rua", "numero", "complemento", "bairro", "cidade", "uf", "cep",
  "matricula", "cartorio", "inscricao_iptu", "sql", "inscricao_municipal", "descricao",
] as const;

function buildKnownFormPaths(): Set<string> {
  const s = new Set<string>();
  for (const list of ["vendedores", "compradores"] as const) {
    s.add(list); // path "guarda-chuva" usado pelos presets
    for (const f of PARTY_FIELDS) s.add(`${list}.0.${f}`);
    for (const sub of PARTY_SUBS) {
      for (const f of PARTY_SUB_FIELDS) s.add(`${list}.0.${sub}.${f}`);
    }
  }
  for (const f of IMOVEL_FIELDS) s.add(`imoveis.0.${f}`);
  for (const f of [
    "valor_total", "sinal_arras", "recursos_proprios", "fgts", "cessao_consorcio",
    "alienacao_fiduciaria", "outras_formas", "meio_pagamento", "banco_financiamento",
  ]) {
    s.add(`pagamento.${f}`);
  }
  for (const f of ["valor", "imobiliaria_nome", "imobiliaria_cnpj", "imobiliaria_email", "creci", "percentual"]) {
    s.add(`comissao.${f}`);
  }
  for (const f of ["modalidade", "status_propriedade", "ocupacao", "foro"]) s.add(f);
  return s;
}

const KNOWN_FORM_PATHS = buildKnownFormPaths();

/** Normaliza segmentos numéricos (índices de array) para `0`. */
function normalizeFormPath(path: string): string {
  return path
    .split(".")
    .map((seg) => (/^\d+$/.test(seg) ? "0" : seg))
    .join(".");
}

/** True se o path é um campo conhecido e obrigatóvel do form de venda. */
export function isKnownFormPath(path: string): boolean {
  return KNOWN_FORM_PATHS.has(normalizeFormPath(path));
}

function extractCustomPathsForStep(
  raw: unknown,
  stepIndex: number,
): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      "step" in item &&
      "path" in item &&
      typeof (item as { step: unknown }).step === "number" &&
      typeof (item as { path: unknown }).path === "string" &&
      (item as { step: number }).step === stepIndex
    ) {
      out.push((item as { path: string }).path);
    }
  }
  return out;
}
