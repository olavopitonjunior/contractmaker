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

// -------------------------------------------------------------------
// Modelo NOVO (2026-07-28): 2 presets nomeados por MÓDULO + custom.
//
// A UI de configuração passou a oferecer apenas `essencial` e `completo`
// (mais "personalizado"), por módulo (venda | locação). Os 4 valores antigos
// de venda (legado/minimo/padrao/completo) continuam VÁLIDOS no banco e
// resolvem exatamente os mesmos arrays de sempre — ver
// `legacyPresetToModuleKey` pra a leitura na UI. Nada de migration de dados:
// `OrgFormSettings.preset` é String.
//
// Essencial = o mínimo pra gerar contrato + mandar pra assinatura:
// nome/identidade fiscal, e-mail, celular e endereço básico das partes.
// Completo = tudo o que os templates e as certidões usam.
// -------------------------------------------------------------------

// Venda — essencial. Novo array (NÃO é alias de legado/minimo): acrescenta
// e-mail + celular + endereço básico, que é o que a ClickSign precisa por
// signatário.
const PRESET_VENDA_ESSENCIAL: readonly (readonly string[])[] = [
  [],
  [
    "vendedores",
    "vendedores.0.cpf",
    "vendedores.0.email",
    "vendedores.0.mobile_phone",
    "vendedores.0.endereco",
    "vendedores.0.cidade",
    "vendedores.0.uf",
  ],
  [
    "compradores",
    "compradores.0.cpf",
    "compradores.0.email",
    "compradores.0.mobile_phone",
    "compradores.0.endereco",
    "compradores.0.cidade",
    "compradores.0.uf",
  ],
  ["imoveis.0.rua", "imoveis.0.cidade", "imoveis.0.uf", "imoveis.0.descricao"],
  [],
  ["pagamento.valor_total"],
  [],
] as const;

export type FormPreset =
  | "legado"
  | "minimo"
  | "padrao"
  | "completo"
  | "essencial"
  | "custom";

export const FORM_REQUIRED_PRESETS: Record<
  Exclude<FormPreset, "custom">,
  readonly (readonly string[])[]
> = {
  legado: PRESET_LEGADO,
  minimo: PRESET_MINIMO,
  padrao: PRESET_PADRAO,
  completo: PRESET_COMPLETO,
  essencial: PRESET_VENDA_ESSENCIAL,
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

// ===================================================================
// LOCAÇÃO — presets por step do wizard de locação (7 etapas,
// LOCACAO_STEP_LABELS): 0 Documentos, 1 Locador(es), 2 Locatário(s),
// 3 Imóvel, 4 Aluguel e Reajuste, 5 Garantia, 6 Comissão (2026-08).
// A antiga etapa de Confirmação saiu em 2026-07-30. As tabelas abaixo têm 6
// entradas — o índice 6 (Comissão) cai no `?? []` de resolveRequiredFields,
// de propósito: comissão nunca é obrigatória pro cliente.
//
// Paths batem com `dadosLocacaoSchema` (lib/forms/validation-locacao.ts) —
// `imovel`/`aluguel`/`garantia` são objetos SINGULARES aqui (em venda são
// arrays). Renomear campo lá exige atualizar aqui, igual em venda.
//
// A etapa 5 (Garantia) fica VAZIA de propósito nos dois presets: o fiador só
// faz sentido quando a garantia é fiança, então exigir `garantia.fiador.*`
// incondicionalmente viraria pendência fantasma. A obrigatoriedade do fiador
// é condicional ao tipo e mora em `collectLocacaoFinalizeIssues` (avisos) e no
// piso `missingFiadorName` (nome bloqueia, desde 2026-09-02 — o tipo pode ser
// definido por um documento atribuído ao fiador na etapa 0).
// ===================================================================

const LOCACAO_PRESET_LEGADO: readonly (readonly string[])[] = [
  [],
  [],
  [],
  [],
  [],
  [],
] as const;

// Essencial: o que a esteira precisa pra gerar o contrato e mandar assinar.
// cpf + mobile_phone entram aqui (dor relatada: locação não exigia nada e a
// parte chegava na ClickSign sem documento nem telefone).
const LOCACAO_PRESET_ESSENCIAL: readonly (readonly string[])[] = [
  [],
  [
    "locadores",
    "locadores.0.cpf",
    "locadores.0.email",
    "locadores.0.mobile_phone",
    "locadores.0.endereco",
    "locadores.0.cidade",
    "locadores.0.uf",
  ],
  [
    "locatarios",
    "locatarios.0.cpf",
    "locatarios.0.email",
    "locatarios.0.mobile_phone",
    "locatarios.0.endereco",
    "locatarios.0.cidade",
    "locatarios.0.uf",
  ],
  ["imovel.rua", "imovel.numero", "imovel.cidade", "imovel.uf"],
  ["aluguel.valor", "aluguel.vigencia_inicio"],
  [],
] as const;

// Completo: + os campos de qualificação que os templates de locação usam
// (rg, nascimento, nacionalidade, estado civil, profissão) e o endereço
// completo das partes + matrícula do imóvel.
const LOCACAO_PRESET_COMPLETO: readonly (readonly string[])[] = [
  [],
  [
    "locadores",
    "locadores.0.cpf",
    "locadores.0.rg",
    "locadores.0.data_nascimento",
    "locadores.0.nacionalidade",
    "locadores.0.estado_civil",
    "locadores.0.profissao",
    "locadores.0.email",
    "locadores.0.mobile_phone",
    "locadores.0.endereco",
    "locadores.0.numero",
    "locadores.0.bairro",
    "locadores.0.cidade",
    "locadores.0.uf",
    "locadores.0.cep",
  ],
  [
    "locatarios",
    "locatarios.0.cpf",
    "locatarios.0.rg",
    "locatarios.0.data_nascimento",
    "locatarios.0.nacionalidade",
    "locatarios.0.estado_civil",
    "locatarios.0.profissao",
    "locatarios.0.email",
    "locatarios.0.mobile_phone",
    "locatarios.0.endereco",
    "locatarios.0.numero",
    "locatarios.0.bairro",
    "locatarios.0.cidade",
    "locatarios.0.uf",
    "locatarios.0.cep",
  ],
  [
    "imovel.rua",
    "imovel.numero",
    "imovel.bairro",
    "imovel.cidade",
    "imovel.uf",
    "imovel.cep",
    "imovel.matricula",
  ],
  ["aluguel.valor", "aluguel.vigencia_inicio", "aluguel.dia_vencimento"],
  [],
] as const;

export const LOCACAO_REQUIRED_PRESETS: Record<
  "legado" | "essencial" | "completo",
  readonly (readonly string[])[]
> = {
  legado: LOCACAO_PRESET_LEGADO,
  essencial: LOCACAO_PRESET_ESSENCIAL,
  completo: LOCACAO_PRESET_COMPLETO,
};

// ===================================================================
// Resolução POR MÓDULO
// ===================================================================

export type FormModule = "venda" | "locacao";

/** Chaves canônicas oferecidas pela UI nova (por módulo). */
export type ModulePresetKey = "essencial" | "completo" | "custom";

export const MODULE_PRESET_KEYS: readonly ModulePresetKey[] = [
  "essencial",
  "completo",
  "custom",
];

/** Valores aceitos em `OrgFormSettings.preset` (venda) — inclui os legados. */
export const VENDA_PRESET_VALUES = [
  "legado",
  "minimo",
  "padrao",
  "completo",
  "essencial",
  "custom",
] as const;

/** Valores aceitos em `OrgFormSettings.locacaoPreset`. */
export const LOCACAO_PRESET_VALUES = [
  "legado",
  "essencial",
  "completo",
  "custom",
] as const;

export interface ModuleFormSettings {
  preset: string;
  customRequiredPaths: unknown;
}

/**
 * Alias LEGADO → chave da UI nova. Usado SÓ pra decidir qual card aparece
 * marcado em /settings/formulario quando a org ainda tem um dos 4 valores
 * antigos de venda.
 *
 * Deliberadamente NÃO é aplicado na resolução: `padrao` continua resolvendo
 * PRESET_PADRAO, `legado` continua resolvendo PRESET_LEGADO. Se o alias valesse
 * na resolução, toda org em produção passaria a exigir campos novos sem que
 * ninguém tivesse mexido na configuração (`padrao` → `completo` acrescentaria
 * RG, nome da mãe, sexo, nascimento e matrícula como obrigatórios da noite pro
 * dia, travando formulários já abertos). A migração acontece quando o admin
 * salva a tela — aí sim o valor canônico é persistido.
 */
export function legacyPresetToModuleKey(
  raw: string | null | undefined,
): ModulePresetKey {
  switch (raw) {
    case "custom":
      return "custom";
    case "padrao":
    case "completo":
      return "completo";
    // legado | minimo | essencial | qualquer coisa desconhecida
    default:
      return "essencial";
  }
}

function presetsForModule(
  module: FormModule,
): Record<string, readonly (readonly string[])[]> {
  return module === "locacao" ? LOCACAO_REQUIRED_PRESETS : FORM_REQUIRED_PRESETS;
}

/**
 * Base default por módulo quando a org nunca configurou nada:
 *  - venda: "legado" (comportamento anterior ao OrgFormSettings);
 *  - locação: "legado" = NADA obrigatório, que é como locação sempre se
 *    comportou (o wizard só exigia nome/descrição/valor por conta própria).
 */
const MODULE_DEFAULT_PRESET: Record<FormModule, string> = {
  venda: "legado",
  locacao: "legado",
};

/** Resolve os obrigatórios de UM step, no módulo indicado. */
export function resolveRequiredFieldsForModule(
  module: FormModule,
  settings: ModuleFormSettings | null,
  stepIndex: number,
): readonly string[] {
  if (stepIndex < 0 || stepIndex >= TOTAL_STEPS) return [];

  const table = presetsForModule(module);
  const preset = settings?.preset ?? MODULE_DEFAULT_PRESET[module];
  const base =
    preset === "custom"
      ? []
      : (table[preset] ?? table[MODULE_DEFAULT_PRESET[module]])[stepIndex] ?? [];

  // Filtra na LEITURA, não só na gravação: paths que já estavam salvos quando
  // a allowlist mudou (ou que nunca tiveram campo na tela) viravam
  // "obrigatoriedade fantasma" — pendência num campo que ninguém consegue
  // preencher, sem saída pelo formulário.
  const isKnown = module === "locacao" ? isKnownLocacaoFormPath : isKnownFormPath;
  const customForStep = extractCustomPathsForStep(
    settings?.customRequiredPaths,
    stepIndex,
  ).filter(isKnown);
  if (customForStep.length === 0) return base;
  return Array.from(new Set([...base, ...customForStep]));
}

/** Versão "todos os steps" — é o que as páginas públicas passam pro client. */
export function resolveAllRequiredFieldsForModule(
  module: FormModule,
  settings: ModuleFormSettings | null,
): readonly (readonly string[])[] {
  return Array.from({ length: TOTAL_STEPS }, (_, i) =>
    resolveRequiredFieldsForModule(module, settings, i),
  );
}

/**
 * Fatia a row de `OrgFormSettings` no par (preset, customRequiredPaths) do
 * módulo. Campos de locação são ADITIVOS na tabela — org que nunca abriu a
 * tela nova cai no default "legado".
 */
export function moduleFormSettings(
  row:
    | {
        preset?: string | null;
        customRequiredPaths?: unknown;
        locacaoPreset?: string | null;
        locacaoCustomRequiredPaths?: unknown;
      }
    | null
    | undefined,
  module: FormModule,
): ModuleFormSettings | null {
  if (!row) return null;
  if (module === "locacao") {
    return {
      preset: row.locacaoPreset ?? "legado",
      customRequiredPaths: row.locacaoCustomRequiredPaths ?? [],
    };
  }
  return {
    preset: row.preset ?? "legado",
    customRequiredPaths: row.customRequiredPaths ?? [],
  };
}

// -------------------------------------------------------------------
// Retrocompat de formulários JÁ ABERTOS (locação)
//
// Mecanismo escolhido: SNAPSHOT na criação. `SalesForm.requiredPreset` guarda
// o preset de locação vigente na org no momento em que o formulário nasceu.
//   - null  → formulário criado ANTES desta feature (ou por um caminho que não
//             registra snapshot): vale o comportamento antigo, ou seja, NADA
//             obrigatório além do piso do wizard;
//   - valor → resolve por esse preset, mesmo que a org troque a configuração
//             depois. Link já enviado ao cliente não muda de exigência no meio
//             do preenchimento.
//
// Escolhido em vez de comparar `form.createdAt` com `settings.updatedAt`
// porque aquele updatedAt é bumpado por QUALQUER alteração da tela (e-mail de
// resumo, auto-lock), o que faria a exigência aparecer e sumir sozinha.
//
// Os `customRequiredPaths` de locação seguem sendo lidos ao vivo em cima do
// preset snapshotado — são ajustes finos aditivos; o congelamento grosso é do
// preset.
// -------------------------------------------------------------------
export function locacaoSettingsForForm(
  row:
    | { locacaoPreset?: string | null; locacaoCustomRequiredPaths?: unknown }
    | null
    | undefined,
  requiredPresetSnapshot: string | null | undefined,
): ModuleFormSettings | null {
  if (!requiredPresetSnapshot || requiredPresetSnapshot === "legado") return null;
  return {
    preset: requiredPresetSnapshot,
    customRequiredPaths: row?.locacaoCustomRequiredPaths ?? [],
  };
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

// Dados de recebimento da parte (PIX + conta), em venda.
const RECEBIMENTO_FIELDS = [
  "pix_chave", "pix_tipo_chave", "banco", "agencia", "conta", "tipo_conta",
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
  // Recebimento (PIX/conta) de quem RECEBE — o campo existe no wizard desde
  // sempre (VendedorStep) e nunca pôde ser exigido, embora seja o que trava o
  // pagamento quando falta.
  for (const list of ["vendedores", "compradores"] as const) {
    for (const f of RECEBIMENTO_FIELDS) s.add(`${list}.0.recebimento.${f}`);
  }
  for (const f of [
    "valor_total", "sinal_arras", "recursos_proprios", "fgts", "cessao_consorcio",
    "alienacao_fiduciaria", "outras_formas", "meio_pagamento", "banco_financiamento",
  ]) {
    s.add(`pagamento.${f}`);
  }
  // `imobiliaria_nome/cnpj/email/creci/percentual` SAÍRAM: não têm input na
  // etapa 7 — são espelhos legados que o código deriva de `comissionados[0]`.
  // Marcá-los criava uma pendência insolúvel num campo que não está na tela.
  s.add("comissao.valor");
  for (const f of ["nome", "cpf", "cnpj", "creci", "email", "mobile_phone", "percentual"]) {
    s.add(`comissao.comissionados.0.${f}`);
  }
  for (const f of ["nome", "cpf", "email"]) s.add(`testemunhas.0.${f}`);
  s.add("observacoes");
  s.add("modalidade");
  // `foro`, `status_propriedade` e `ocupacao` SAÍRAM: `foro` deixou de ser
  // coletado no formulário público (virou aba Configurações do contrato) e os
  // outros dois têm default não-vazio no schema — a exigência nunca dispararia.
  return s;
}

const KNOWN_FORM_PATHS = buildKnownFormPaths();

/**
 * A allowlist como LISTA, para a tela de Configurações → Formulário montar os
 * checkboxes a partir dela.
 *
 * Antes, a tela tinha um catálogo estático próprio (`field-labels.ts`) com um
 * subconjunto do que a API aceita: campo que existia no formulário e era
 * obrigatóvel pela rota simplesmente não aparecia para o admin marcar — a
 * etapa Comissão inteira, os encargos de locação, a garantia, o endereço do
 * cônjuge. Derivar daqui elimina a segunda lista.
 */
export const KNOWN_FORM_PATH_LIST: readonly string[] = [...KNOWN_FORM_PATHS];

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

// Allowlist equivalente pro form de LOCAÇÃO (dadosLocacaoSchema). Mesma razão
// de existir: path órfão salvo em `locacaoCustomRequiredPaths` seria uma
// obrigatoriedade que nunca dispara.
const LOCACAO_PARTY_FIELDS = [
  "nome", "razao_social", "cnpj", "cpf", "rg", "data_nascimento",
  "nome_mae", "sexo",
  "nacionalidade", "estado_civil", "profissao", "email", "mobile_phone",
  "endereco", "numero", "complemento", "bairro", "cidade", "uf", "cep",
  "renda_mensal", "faturamento_mensal",
] as const;

const LOCACAO_CONJUGE_FIELDS = [
  "nome", "cpf", "rg", "nacionalidade", "profissao", "data_nascimento",
  "email", "mobile_phone", "endereco", "numero", "complemento", "bairro",
  "cidade", "uf", "cep",
] as const;

const LOCACAO_REPRESENTANTE_FIELDS = ["nome", "cpf", "email", "mobile_phone"] as const;

const LOCACAO_IMOVEL_FIELDS = [
  "kind", "rua", "numero", "complemento", "bairro", "cidade", "uf", "cep",
  "matricula", "cartorio", "inscricao_iptu", "area", "vagas_garagem",
  "condominio_nome", "descricao", "destinacao",
] as const;

const LOCACAO_ALUGUEL_FIELDS = [
  "valor", "encargos", "dia_vencimento", "indice_reajuste", "vigencia_inicio",
  "vigencia_meses", "taxa_admin_percent", "meio_pagamento", "iptu_mensal",
  "condominio_mensal", "outros_encargos",
  // Administração/despesas no form público (2026-08).
  "adm_imobiliaria", "encargos_repasse", "contas_consumo_individualizadas",
  "contas_no_condominio",
] as const;

const LOCACAO_GARANTIA_FIELDS = [
  "tipo", "provider", "cobertura_meses", "caucao_meses", "titulo_valor",
  "titulo_proposta",
] as const;

function buildKnownLocacaoPaths(): Set<string> {
  const s = new Set<string>();
  const addParty = (prefix: string) => {
    for (const f of LOCACAO_PARTY_FIELDS) s.add(`${prefix}.${f}`);
    for (const f of LOCACAO_CONJUGE_FIELDS) s.add(`${prefix}.conjuge.${f}`);
    for (const f of LOCACAO_REPRESENTANTE_FIELDS) s.add(`${prefix}.representante.${f}`);
  };
  for (const list of ["locadores", "locatarios"] as const) {
    s.add(list); // path guarda-chuva (array não-vazio)
    addParty(`${list}.0`);
  }
  // `garantia.fiador.*` SAIU: `PARTY_PATH_RE` (party-required) não casa esse
  // prefixo, então o path passava sem o remap PF/PJ e sem checar se a garantia
  // é fiança — exigência incondicional de um campo que só existe às vezes. A
  // obrigatoriedade do fiador é condicional ao tipo: avisos em
  // collectLocacaoFinalizeIssues, nome como piso em missingFiadorName.
  for (const f of LOCACAO_IMOVEL_FIELDS) s.add(`imovel.${f}`);
  for (const f of LOCACAO_ALUGUEL_FIELDS) s.add(`aluguel.${f}`);
  for (const f of LOCACAO_GARANTIA_FIELDS) s.add(`garantia.${f}`);
  for (const f of ["taxa_locacao_percent", "taxa_locacao_valor"]) {
    s.add(`comissao.${f}`);
  }
  for (const f of ["nome", "cpf", "cnpj", "creci", "email", "mobile_phone"]) {
    s.add(`comissao.angariadores.0.${f}`);
  }
  s.add("observacoes");
  // `assinatura.*`, `foro` e `vistoria_ref` SAÍRAM: a etapa "Confirmação e
  // Assinatura" foi removida em 2026-07-30 e `vistoria_ref` não tem input no
  // wizard — nenhum dos três pode ser preenchido por quem responde o formulário.
  return s;
}

const KNOWN_LOCACAO_PATHS = buildKnownLocacaoPaths();

/** Gêmeo de `KNOWN_FORM_PATH_LIST` para locação. */
export const KNOWN_LOCACAO_PATH_LIST: readonly string[] = [...KNOWN_LOCACAO_PATHS];

/** True se o path é um campo conhecido e obrigatóvel do form de locação. */
export function isKnownLocacaoFormPath(path: string): boolean {
  return KNOWN_LOCACAO_PATHS.has(normalizeFormPath(path));
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
