import { z } from "zod";

/**
 * Categorias de TERCEIRO nos links por parte do formulário público.
 *
 * Os 5 papéis nativos (vendedor/comprador; locador/locatario/fiador) são
 * fechados em código porque escrevem em subárvores conhecidas do
 * `DadosContrato` — cada um tem step, validação e OCR próprios. Terceiro é o
 * oposto: a imobiliária define a categoria (interveniente anuente, procurador
 * externo, gestor do condomínio…) e os campos que ela quer coletar.
 *
 * Modelagem:
 *   - definição por org em `FormParticipantCategory` (slug kebab @@unique por
 *     org + field defs em Json);
 *   - `SalesFormParticipant.role` = `"terceiro:<slug>"` (a coluna já é String,
 *     sem enum — nenhuma migration de dados);
 *   - respostas em `dataJson.terceiros.<slug>[]`, namespace ADITIVO que não
 *     colide com nenhuma chave do schema de venda nem de locação.
 *
 * Nada aqui toca os 5 papéis nativos: `resolveRolePaths`/`resolveRoleSteps`
 * continuam devolvendo exatamente os mapas antigos pra eles.
 */

/** Prefixo do `role` sintético. Fora dele, é papel nativo. */
export const TERCEIRO_ROLE_PREFIX = "terceiro:";

/** Chave top-level do `dataJson` onde toda categoria de terceiro escreve. */
export const TERCEIRO_DATA_KEY = "terceiros";

export const CATEGORY_FIELD_TYPES = [
  "text",
  "cpf",
  "cnpj",
  "email",
  "phone",
  "date",
  "textarea",
] as const;

export type CategoryFieldType = (typeof CATEGORY_FIELD_TYPES)[number];

export const CATEGORY_FIELD_TYPE_LABELS: Record<CategoryFieldType, string> = {
  text: "Texto",
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  date: "Data",
  textarea: "Texto longo",
};

export interface CategoryFieldDef {
  /** snake_case — vira a chave dentro de `terceiros.<slug>[i]`. */
  key: string;
  label: string;
  type: CategoryFieldType;
  required: boolean;
}

/** Módulos onde a categoria pode ser oferecida. */
export const CATEGORY_MODULES = ["venda", "locacao"] as const;
export type CategoryModule = (typeof CATEGORY_MODULES)[number];

export interface ParticipantCategory {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  appliesTo: CategoryModule[];
  fields: CategoryFieldDef[];
  active: boolean;
}

// Slug kebab-case: entra na URL do role e no path do dataJson — sem ponto
// (quebraria o path pontilhado) e sem maiúsculas (o @@unique é sensível).
export const CATEGORY_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Chave de campo snake_case: vira propriedade JSON e path `...<idx>.<key>`.
export const CATEGORY_FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

export const categoryFieldDefSchema = z.object({
  key: z.string().min(1).max(40).regex(CATEGORY_FIELD_KEY_RE, "Use snake_case (letras minúsculas, dígitos e _)"),
  label: z.string().min(1).max(80),
  type: z.enum(CATEGORY_FIELD_TYPES),
  required: z.boolean().default(false),
});

/** Lista de campos: até 30, sem chaves repetidas. */
export const categoryFieldsSchema = z
  .array(categoryFieldDefSchema)
  .max(30)
  .refine(
    (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
    "Chaves de campo duplicadas",
  );

export const categoryAppliesToSchema = z
  .array(z.enum(CATEGORY_MODULES))
  .min(1, "Escolha ao menos um módulo")
  .max(CATEGORY_MODULES.length);

export const categorySlugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(CATEGORY_SLUG_RE, "Use kebab-case (ex.: interveniente-anuente)");

/** Normaliza um label livre em slug kebab (sugestão da UI e fallback do POST). */
export function slugifyCategoryLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** `"interveniente-anuente"` → `"terceiro:interveniente-anuente"`. */
export function terceiroRole(slug: string): string {
  return `${TERCEIRO_ROLE_PREFIX}${slug}`;
}

export function isTerceiroRole(role: string): boolean {
  return role.startsWith(TERCEIRO_ROLE_PREFIX);
}

/**
 * Extrai o slug de um role de terceiro. Devolve `null` pra papel nativo OU pra
 * slug malformado — a validação de formato aqui é o que impede um role forjado
 * de virar path arbitrário no `dataJson`.
 */
export function parseTerceiroRole(role: string): string | null {
  if (!isTerceiroRole(role)) return null;
  const slug = role.slice(TERCEIRO_ROLE_PREFIX.length);
  return CATEGORY_SLUG_RE.test(slug) ? slug : null;
}

/** Escopo de paths do link de terceiro — sempre uma única subárvore. */
export function categoryPathScope(slug: string): string[] {
  return [`${TERCEIRO_DATA_KEY}.${slug}`];
}

/**
 * Paths obrigatórios DA CATEGORIA, no slot desta parte. Alimenta o mesmo
 * `findMissingRequired` que o resto do form usa (o path não casa
 * `PARTY_PATH_RE`, então passa intacto pelo remap PF/PJ).
 */
export function requiredPathsForCategory(
  slug: string,
  partyIndex: number,
  fields: readonly CategoryFieldDef[],
): string[] {
  return fields
    .filter((f) => f.required)
    .map((f) => `${TERCEIRO_DATA_KEY}.${slug}.${partyIndex}.${f.key}`);
}

/**
 * Lê as field defs vindas da coluna `Json` de forma defensiva: linha gravada
 * por versão anterior (ou editada à mão) não pode derrubar a página pública.
 * Item inválido é descartado, não lançado.
 */
export function parseCategoryFields(raw: unknown): CategoryFieldDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CategoryFieldDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = categoryFieldDefSchema.safeParse(item);
    if (!parsed.success) continue;
    if (seen.has(parsed.data.key)) continue;
    seen.add(parsed.data.key);
    out.push(parsed.data);
  }
  return out;
}

/** Idem pra `appliesTo` (String[] no banco). */
export function parseCategoryAppliesTo(raw: unknown): CategoryModule[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is CategoryModule =>
    (CATEGORY_MODULES as readonly string[]).includes(m as string),
  );
}

/** Esteira do formulário — mesma regra do resto do código (`schemaType`). */
export function moduleOfSchemaType(
  schemaType: string | null | undefined,
): CategoryModule {
  return schemaType?.startsWith("locacao") ? "locacao" : "venda";
}

/** Papéis nativos por esteira — inalterados desde a criação da feature. */
export const VENDA_BUILTIN_ROLES: readonly string[] = ["vendedor", "comprador"];
export const LOCACAO_BUILTIN_ROLES: readonly string[] = [
  "locador",
  "locatario",
  "fiador",
];

/** Todos os papéis nativos, sem depender de `participant-token` (evita ciclo). */
const ALL_BUILTIN_ROLES: readonly string[] = [
  ...VENDA_BUILTIN_ROLES,
  ...LOCACAO_BUILTIN_ROLES,
];

/**
 * Zod de um `role` de participante aceito pelas APIs de criação de link:
 * um dos 5 nativos OU `terceiro:<slug>` bem-formado. A EXISTÊNCIA da categoria
 * não cabe aqui (depende do banco) — é o `isValidRole` que checa.
 */
export const participantRoleSchema = z
  .string()
  .min(1)
  .max(60)
  .refine(
    (r) => ALL_BUILTIN_ROLES.includes(r) || parseTerceiroRole(r) !== null,
    "Papel de participante inválido",
  );

export type RoleValidation =
  | { ok: true; slug: string | null }
  | { ok: false; error: string };

/**
 * Um `role` pedido pode ser criado neste formulário?
 *
 *  - papel nativo: precisa bater com a esteira do `schemaType` (regra antiga,
 *    preservada tal e qual — vendedor em form de locação segue inválido);
 *  - terceiro: precisa existir uma categoria ATIVA da org com aquele slug e
 *    cujo `appliesTo` inclua a esteira do formulário.
 *
 * `categories` é a lista da org (já carregada pelo caller) — a função é pura
 * de propósito, pra ser testável sem banco.
 */
export function isValidRole(
  role: string,
  schemaType: string | null | undefined,
  categories: readonly ParticipantCategory[],
): RoleValidation {
  const mod = moduleOfSchemaType(schemaType);
  if (!isTerceiroRole(role)) {
    const allowed =
      mod === "locacao" ? LOCACAO_BUILTIN_ROLES : VENDA_BUILTIN_ROLES;
    if (!allowed.includes(role)) {
      return {
        ok: false,
        error: `Role ${role} não vale pra um formulário de ${mod === "locacao" ? "locação" : "venda"}`,
      };
    }
    return { ok: true, slug: null };
  }

  const slug = parseTerceiroRole(role);
  if (!slug) return { ok: false, error: "Categoria de terceiro inválida" };

  const category = categories.find((c) => c.slug === slug);
  if (!category) {
    return { ok: false, error: `Categoria "${slug}" não existe nesta imobiliária` };
  }
  if (!category.active) {
    return { ok: false, error: `Categoria "${category.label}" está desativada` };
  }
  if (!category.appliesTo.includes(mod)) {
    return {
      ok: false,
      error: `Categoria "${category.label}" não está habilitada para ${mod === "locacao" ? "locação" : "venda"}`,
    };
  }
  return { ok: true, slug };
}
