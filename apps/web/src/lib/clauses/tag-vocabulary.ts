/**
 * Vocabulário canônico de tags do acervo de cláusulas — GLOBAL a todos os tenants.
 *
 * Por que global: o agente classificador é universal. Se cada imobiliária
 * inventasse o próprio vocabulário, a mesma cláusula receberia tags diferentes em
 * dois tenants e a base de PLATAFORMA (`orgId IS NULL`, lida por todos) ficaria
 * inbuscável. O VOCABULÁRIO é global; o VALOR gravado na linha continua
 * org-scoped, porque a tag é coluna da linha e o escopo vem de `knowledgeScopeWhere`.
 *
 * Dado puro, client-safe (sem prisma, sem rede) — o editor e o classificador leem
 * este mesmo módulo, que é como se evita o fork de listas.
 *
 * ## As três camadas (a distinção que impede corromper acervo)
 *
 * **CAMADA 1 — IDENTIDADE.** `slot:` `garantia:` `provider:` `cobertura:`.
 * Reexportadas de `lib/templates/clause-slots.ts`, nunca redefinidas aqui. São
 * canônicas porque a GERAÇÃO de contrato casa por igualdade de tag
 * (`resolveClauseSlots`), e porque o CONJUNTO EXATO delas é a chave de
 * idempotência da reingestão (`ingest-clauses.ts`: `sameTagSet`,
 * `selectExactTagMatches`). Consequência prática, e é a armadilha central deste
 * módulo: **acrescentar** uma tag qualquer a uma cláusula dessas origens já muda
 * o conjunto — o `hasEvery` ainda a traz como candidata, mas `sameTagSet` a
 * rejeita, e a próxima reingestão CRIA UMA DUPLICATA em vez de arquivar a
 * anterior. Por isso o classificador nunca propõe camada 1 e as origens de
 * identidade têm as tags CONGELADAS (`areTagsFrozen`).
 *
 * **CAMADA 2 — DESCRITIVAS CANÔNICAS.** `tema:` `lei:` `risco:` `requer:`.
 * Vocabulário fechado, novo, seguro de atribuir por IA: nada na geração casa por
 * elas; servem à busca, ao filtro e ao contexto do agente.
 *
 * **CAMADA 3 — LIVRES.** Qualquer outra string. Preservadas como estão. Os dois
 * seeds legados divergem de propósito conhecido — locação usa espaço
 * (`"despesas ordinarias"`), venda usa hífen (`"pluralidade-vendedores"`) — e
 * NÃO são normalizadas aqui: reescrevê-las mudaria conjuntos de tags e é
 * exatamente o estrago descrito acima. A normalização retroativa é fase própria,
 * e só depois de trocar a identidade para o subconjunto canônico.
 */
import {
  SLOT_TAG_PREFIX,
  PROVIDER_TAG_PREFIX,
  COVERAGE_TAG_PREFIX,
  CLAUSE_SLOT_KEYS,
} from "@/lib/templates/clause-slots";
import type { FormModule } from "@/lib/forms/presets";
import type { ClauseEsteira } from "@/lib/clauses/taxonomy";

export const TAG_CATALOG_VERSION = 1;

// ===========================================================================
// CAMADA 1 — IDENTIDADE (congelada; re-exportada, nunca redefinida)
// ===========================================================================

/**
 * Prefixos de identidade. `garantia:` não tem constante própria em
 * `clause-slots.ts` — é `slotValueTag`, montado como `<slot>:<valor>`; como só
 * existe um slot (`CLAUSE_SLOT_KEYS = ["garantia"]`), derivamos daí em vez de
 * escrever a string à mão, pra que um slot novo entre sozinho.
 */
export const IDENTITY_TAG_PREFIXES: readonly string[] = [
  SLOT_TAG_PREFIX,
  PROVIDER_TAG_PREFIX,
  COVERAGE_TAG_PREFIX,
  ...CLAUSE_SLOT_KEYS.map((slot) => `${slot}:`),
];

/** A tag amarra a seleção na geração de contrato? Se sim, IA não toca. */
export function isIdentityTag(tag: string): boolean {
  return IDENTITY_TAG_PREFIXES.some((p) => tag.startsWith(p));
}

/**
 * Origens cuja identidade É o conjunto de tags. Espelha os `source` gravados por
 * `ingest-clauses.ts` (`CLAUSE_INGEST_SOURCE`) e pelo seed do pacote curado.
 */
export const FROZEN_TAG_SOURCES: readonly string[] = [
  "consolidacao_modelos",
  "seed_curado",
];

/**
 * As tags desta cláusula podem ser alteradas?
 *
 * Congela quando a origem é de identidade OU quando a cláusula já carrega
 * qualquer tag de identidade (cobre linha cuja `source` se perdeu numa migração
 * mas que o resolvedor de slot ainda seleciona por tag).
 */
export function areTagsFrozen(input: {
  source?: string | null;
  tags?: readonly string[] | null;
}): boolean {
  const source = (input.source ?? "").trim();
  if (FROZEN_TAG_SOURCES.includes(source)) return true;
  return (input.tags ?? []).some(isIdentityTag);
}

// ===========================================================================
// CAMADA 2 — DESCRITIVAS CANÔNICAS
// ===========================================================================

export const TEMA_PREFIX = "tema:";
export const LEI_PREFIX = "lei:";
export const RISCO_PREFIX = "risco:";
export const REQUER_PREFIX = "requer:";

export const DESCRIPTIVE_TAG_PREFIXES: readonly string[] = [
  TEMA_PREFIX,
  LEI_PREFIX,
  RISCO_PREFIX,
  REQUER_PREFIX,
];

export interface TagDef {
  /** A tag completa, já com prefixo e já normalizada. */
  tag: string;
  label: string;
  /** Em que esteiras a tag faz sentido — filtra o autocomplete e o prompt. */
  esteiras: readonly ClauseEsteira[];
  description?: string;
}

const BOTH: readonly ClauseEsteira[] = ["venda", "locacao", "ambas"];
const VENDA: readonly ClauseEsteira[] = ["venda"];
const LOCACAO: readonly ClauseEsteira[] = ["locacao"];

/**
 * `tema:` — assunto jurídico da cláusula. Espelha as `subcategory` que os dois
 * seeds já usam, mais os temas que os `agentNotes` nomeiam. É a faceta que o
 * classificador mais usa.
 */
export const TEMA_VOCABULARY: readonly TagDef[] = [
  // — locação (Lei 8.245/91)
  { tag: "tema:garantia", label: "Garantia locatícia", esteiras: LOCACAO },
  { tag: "tema:reajuste", label: "Reajuste e índice", esteiras: LOCACAO },
  { tag: "tema:encargos", label: "Encargos e despesas", esteiras: LOCACAO },
  { tag: "tema:uso", label: "Uso e destinação", esteiras: LOCACAO },
  { tag: "tema:vistoria", label: "Vistoria e conservação", esteiras: LOCACAO },
  { tag: "tema:benfeitorias", label: "Benfeitorias", esteiras: LOCACAO },
  { tag: "tema:devolucao", label: "Devolução do imóvel", esteiras: LOCACAO },
  { tag: "tema:preferencia", label: "Direito de preferência", esteiras: LOCACAO },
  { tag: "tema:renovatoria", label: "Ação renovatória", esteiras: LOCACAO },
  { tag: "tema:sublocacao", label: "Sublocação e cessão", esteiras: LOCACAO },
  // — venda (CCV)
  { tag: "tema:arras", label: "Arras e sinal", esteiras: VENDA },
  { tag: "tema:imissao", label: "Imissão na posse", esteiras: VENDA },
  { tag: "tema:financiamento", label: "Financiamento", esteiras: VENDA },
  { tag: "tema:registro", label: "Registro e escritura", esteiras: VENDA },
  { tag: "tema:fgts", label: "FGTS", esteiras: VENDA },
  { tag: "tema:comissao", label: "Comissão de corretagem", esteiras: VENDA },
  { tag: "tema:condicao-resolutiva", label: "Condição resolutiva", esteiras: VENDA },
  // — comuns às duas
  { tag: "tema:rescisao", label: "Rescisão e multa", esteiras: BOTH },
  { tag: "tema:partes", label: "Qualificação das partes", esteiras: BOTH },
  { tag: "tema:objeto", label: "Objeto do contrato", esteiras: BOTH },
  { tag: "tema:preco", label: "Preço e pagamento", esteiras: BOTH },
  { tag: "tema:prazo", label: "Prazo e vigência", esteiras: BOTH },
  { tag: "tema:foro", label: "Foro e jurisdição", esteiras: BOTH },
  { tag: "tema:assinatura-eletronica", label: "Assinatura eletrônica", esteiras: BOTH },
  { tag: "tema:lgpd", label: "Proteção de dados", esteiras: BOTH },
  { tag: "tema:declaracoes", label: "Declarações", esteiras: BOTH },
  { tag: "tema:seguro", label: "Seguro", esteiras: BOTH },
];

/** `lei:` — base legal citada. Separador hífen (o `_` fica restrito a `provider:`). */
export const LEI_VOCABULARY: readonly TagDef[] = [
  { tag: "lei:8245-91", label: "Lei do Inquilinato (8.245/91)", esteiras: LOCACAO },
  { tag: "lei:cc-417", label: "Arras — art. 417 do Código Civil", esteiras: VENDA },
  { tag: "lei:8036-90", label: "FGTS (Lei 8.036/90)", esteiras: VENDA },
  { tag: "lei:bcb-4676", label: "Resolução BCB 4.676/2018", esteiras: VENDA },
  { tag: "lei:cc", label: "Código Civil", esteiras: BOTH },
  { tag: "lei:mp-2200", label: "Assinatura eletrônica (MP 2.200-2/2001)", esteiras: BOTH },
  { tag: "lei:lgpd", label: "LGPD (Lei 13.709/18)", esteiras: BOTH },
];

/** `risco:` — de quem é o ônus principal da cláusula. Útil pra revisão jurídica. */
export const RISCO_VOCABULARY: readonly TagDef[] = [
  { tag: "risco:locador", label: "Onera o locador", esteiras: LOCACAO },
  { tag: "risco:locatario", label: "Onera o locatário", esteiras: LOCACAO },
  { tag: "risco:fiador", label: "Onera o fiador", esteiras: LOCACAO },
  { tag: "risco:vendedor", label: "Onera o vendedor", esteiras: VENDA },
  { tag: "risco:comprador", label: "Onera o comprador", esteiras: VENDA },
  { tag: "risco:imobiliaria", label: "Onera a imobiliária", esteiras: BOTH },
  { tag: "risco:neutro", label: "Simétrica entre as partes", esteiras: BOTH },
];

/** `requer:` — condição do negócio que torna a cláusula aplicável. */
export const REQUER_VOCABULARY: readonly TagDef[] = [
  { tag: "requer:financiamento", label: "Só com financiamento", esteiras: VENDA },
  { tag: "requer:fgts", label: "Só com uso de FGTS", esteiras: VENDA },
  { tag: "requer:pluralidade-vendedores", label: "Só com mais de um vendedor", esteiras: VENDA },
  { tag: "requer:pj", label: "Só quando há pessoa jurídica", esteiras: BOTH },
  { tag: "requer:adm-imobiliaria", label: "Só com administração pela imobiliária", esteiras: LOCACAO },
  { tag: "requer:temporada", label: "Só em locação por temporada", esteiras: LOCACAO },
];

/** Todo o vocabulário descritivo, numa lista só. */
export const DESCRIPTIVE_VOCABULARY: readonly TagDef[] = [
  ...TEMA_VOCABULARY,
  ...LEI_VOCABULARY,
  ...RISCO_VOCABULARY,
  ...REQUER_VOCABULARY,
];

/** Índice por tag, pra lookup O(1) na validação do que o LLM devolveu. */
const BY_TAG: ReadonlyMap<string, TagDef> = new Map(
  DESCRIPTIVE_VOCABULARY.map((d) => [d.tag, d])
);

export function tagDef(tag: string): TagDef | null {
  return BY_TAG.get(tag) ?? null;
}

/** A tag pertence ao vocabulário descritivo fechado? */
export function isDescriptiveTag(tag: string): boolean {
  return BY_TAG.has(tag);
}

/** Canônica = identidade OU descritiva conhecida. O resto é livre (camada 3). */
export function isCanonicalTag(tag: string): boolean {
  return isIdentityTag(tag) || isDescriptiveTag(tag);
}

/** Faceta e valor de uma tag com prefixo conhecido. `null` em tag livre. */
export function parseFacet(tag: string): { prefix: string; value: string } | null {
  const all = [...IDENTITY_TAG_PREFIXES, ...DESCRIPTIVE_TAG_PREFIXES];
  const prefix = all.find((p) => tag.startsWith(p));
  if (!prefix) return null;
  return { prefix, value: tag.slice(prefix.length) };
}

/** Vocabulário descritivo aplicável a uma esteira — filtra autocomplete e prompt. */
export function descriptiveVocabularyFor(
  esteira: FormModule | "ambas"
): readonly TagDef[] {
  if (esteira === "ambas") return DESCRIPTIVE_VOCABULARY;
  return DESCRIPTIVE_VOCABULARY.filter(
    (d) => d.esteiras.includes(esteira) || d.esteiras.includes("ambas")
  );
}

// ===========================================================================
// Normalização — só para tag NOVA
// ===========================================================================

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Normaliza uma tag descritiva/livre nova: minúsculas, sem acento, hífen como
 * separador. O prefixo (`tema:`) é preservado; só o valor é normalizado.
 *
 * NUNCA aplicar a tag existente: mudar `"despesas ordinarias"` para
 * `"despesas-ordinarias"` altera o conjunto de tags da linha e quebra a
 * idempotência da reingestão. Tag de identidade também não passa por aqui —
 * `provider:` usa `_` de propósito (ver `slugifyProviderTag`).
 */
export function normalizeDescriptiveTag(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (isIdentityTag(trimmed)) return trimmed;

  const facet = DESCRIPTIVE_TAG_PREFIXES.find((p) => trimmed.startsWith(p));
  const prefix = facet ?? "";
  const value = facet ? trimmed.slice(facet.length) : trimmed;

  const slug = value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${prefix}${slug}`;
}

/**
 * Mescla tags propostas às atuais, de forma ADITIVA e segura:
 * - se as tags estão congeladas, devolve as atuais intactas;
 * - descarta proposta de identidade (IA não atribui o que amarra a geração);
 * - descarta proposta fora do vocabulário descritivo;
 * - preserva ordem e não duplica.
 *
 * Devolve `null` quando nada mudaria — o chamador omite o campo da proposta em
 * vez de mostrar um diff vazio ao revisor.
 */
export function mergeDescriptiveTags(
  current: readonly string[],
  proposed: readonly string[],
  opts: { frozen: boolean }
): string[] | null {
  if (opts.frozen) return null;

  const out = [...current];
  const seen = new Set(current);
  for (const raw of proposed) {
    const tag = normalizeDescriptiveTag(raw);
    if (!tag || seen.has(tag)) continue;
    if (isIdentityTag(tag)) continue;
    if (!isDescriptiveTag(tag)) continue;
    out.push(tag);
    seen.add(tag);
  }
  return out.length === current.length ? null : out;
}
