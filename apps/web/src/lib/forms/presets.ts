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
const PRESET_PADRAO: readonly (readonly string[])[] = [
  [],
  [
    "vendedores",
    "vendedores.0.cpf",
    "vendedores.0.estado_civil",
    "vendedores.0.endereco",
    "vendedores.0.cidade",
    "vendedores.0.uf",
  ],
  [
    "compradores",
    "compradores.0.cpf",
    "compradores.0.estado_civil",
    "compradores.0.endereco",
    "compradores.0.cidade",
    "compradores.0.uf",
  ],
  ["imoveis.0.rua", "imoveis.0.cidade", "imoveis.0.uf", "imoveis.0.descricao"],
  [],
  ["pagamento.valor_total"],
  [],
] as const;

// Completo: + RG, data_nascimento, nome_mae, naturalidade.
// Necessários por TJSP/PGFN/Antecedentes PF (Phase H 2026-04-18).
const PRESET_COMPLETO: readonly (readonly string[])[] = [
  [],
  [
    "vendedores",
    "vendedores.0.cpf",
    "vendedores.0.rg",
    "vendedores.0.data_nascimento",
    "vendedores.0.nome_mae",
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
