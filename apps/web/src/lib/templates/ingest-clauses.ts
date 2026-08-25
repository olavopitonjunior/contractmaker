/**
 * Ingestão de cláusulas de slot — o miolo do POST /api/templates/ingest/clauses.
 *
 * Vive fora da rota porque o executor da ingestão em lote (server-side) precisa
 * chamar a MESMA lógica sem HTTP self-call: a rota vira casca (auth + zod +
 * resposta) e este módulo carrega a semântica.
 *
 * O que a consolidação produz: os blocos que divergiam entre N modelos quase
 * idênticos viram cláusulas do acervo, cada uma amarrada à opção do formulário
 * por tag (`slot:garantia` + `garantia:fiador`) e, quando o texto é de um
 * garantidor específico, também por `provider:porto_seguro`. Na geração,
 * `resolveClauseSlots` casa a escolha do form com as tags.
 *
 * ## A trava que existe aqui: idempotência por conjunto EXATO de tags
 *
 * Reingerir o mesmo lote tem que CORRIGIR o acervo, não duplicá-lo — por isso a
 * cláusula anterior do mesmo conjunto de tags é ARQUIVADA antes de gravar a
 * nova. O perigo está em COMO se acha "a anterior": `tags: { hasEvery: [...] }`
 * é SUBCONJUNTO. Ingerir uma cláusula genérica de `["slot:garantia",
 * "garantia:seguro_fianca"]` casaria, por `hasEvery`, TODAS as cláusulas que
 * têm essas duas tags MAIS `provider:porto_seguro`, `provider:pottencial`, etc.
 * — ou seja, um único POST genérico arquivaria o acervo curado inteiro do
 * tenant (na RE/MAX Ativa, 20 cláusulas aprovadas com embedding).
 *
 * A correção: `hasEvery` continua sendo o filtro do BANCO (é o que o índice
 * GIN sabe fazer), mas ele só traz CANDIDATOS. A decisão é em memória, por
 * IGUALDADE DE CONJUNTO (`sameTagSet`), e o arquivamento é por `id IN (...)`.
 * Genérica nunca arquiva cláusula de garantidor, e vice-versa.
 */

import { prisma } from "@/lib/db/prisma";
import {
  createKnowledgeItemRows,
  type EmbedTarget,
  type KnowledgeWriteClient,
} from "@/lib/ai/knowledge";
import {
  CLAUSE_SLOTS,
  PROVIDER_TAG_PREFIX,
  slotTagsFor,
  slugifyProviderTag,
  type ClauseSlotKey,
} from "@/lib/templates/clause-slots";

/** `source` gravado em toda cláusula que nasce da consolidação de modelos. */
export const CLAUSE_INGEST_SOURCE = "consolidacao_modelos";

export interface IngestClauseVariant {
  /** Opção do formulário (ex.: `fiador`) — vira a tag `garantia:fiador`. */
  value: string;
  /**
   * Garantidor da redação, no RÓTULO humano do catálogo da org ("Porto
   * Seguro"). Slugificado aqui pra `provider:porto_seguro`. Ausente = cláusula
   * GENÉRICA do tipo, elegível quando o form não escolheu garantidor.
   */
  provider?: string | null;
  title?: string;
  content: string;
}

export interface IngestSlotClausesInput {
  orgId: string;
  slot: ClauseSlotKey;
  /** Nome do lote consolidado — vira prefixo do título de cada cláusula. */
  sourceName: string;
  variants: IngestClauseVariant[];
  createdBy?: string | null;
}

export interface IngestedClause {
  id: string;
  title: string;
  value: string;
  /** Garantidor JÁ slugificado (`porto_seguro`), ou null na cláusula genérica. */
  provider: string | null;
  tags: string[];
  /** Cláusulas do acervo arquivadas por esta variante (conjunto exato de tags). */
  archivedIds: string[];
}

export interface IngestSlotClausesResult {
  slot: ClauseSlotKey;
  items: IngestedClause[];
  /**
   * Alvos de embedding. O caller decide QUANDO embutir: a rota manda pro
   * `waitUntil` (Voyage é externo e não pode segurar a resposta); o executor em
   * lote pode aguardar.
   */
  embedTargets: EmbedTarget[];
}

/**
 * Payload que a ingestão recusa (rota devolve 422). Erro de banco NÃO passa por
 * aqui — sobe cru pro caller tratar como 500.
 */
export class ClauseIngestValidationError extends Error {
  readonly status = 422 as const;
  constructor(message: string) {
    super(message);
    this.name = "ClauseIngestValidationError";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Conjunto de tags — funções puras (o núcleo testável da idempotência)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Forma canônica de um conjunto de tags: sem espaço nas pontas, minúsculo, sem
 * vazio, sem repetido e ORDENADO. Duas cláusulas "são a mesma" quando esta
 * forma coincide — a ordem de gravação e o caixa das tags não podem decidir se
 * o acervo de alguém é arquivado.
 */
export function canonicalTagSet(tags: readonly string[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const tag of tags ?? []) {
    const norm = String(tag).trim().toLowerCase();
    if (norm) set.add(norm);
  }
  return Array.from(set).sort();
}

/** Igualdade de CONJUNTO (não de subconjunto) entre duas listas de tags. */
export function sameTagSet(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
): boolean {
  const left = canonicalTagSet(a);
  const right = canonicalTagSet(b);
  return left.length === right.length && left.every((tag, i) => tag === right[i]);
}

/** Linha do acervo considerada para arquivamento. */
export interface ArchiveCandidate {
  id: string;
  tags?: string[] | null;
}

/**
 * Dos candidatos que o `hasEvery` trouxe, os que a nova cláusula SUBSTITUI —
 * só os de conjunto de tags idêntico.
 *
 * É esta função que separa "reingestão do mesmo texto" de "cláusula nova que
 * por acaso compartilha tags". Uma genérica (`slot:garantia`,
 * `garantia:seguro_fianca`) NUNCA casa com uma curada que também tem
 * `provider:porto_seguro`: os conjuntos têm tamanhos diferentes.
 */
export function selectExactTagMatches(
  candidates: readonly ArchiveCandidate[],
  tags: readonly string[]
): string[] {
  return candidates.filter((c) => sameTagSet(c.tags, tags)).map((c) => c.id);
}

/**
 * Tags gravadas numa variante: o par do slot + o garantidor, quando houver.
 * `provider` entra JÁ slugificado (`porto_seguro`).
 */
export function variantTags(
  slot: ClauseSlotKey,
  value: string,
  provider: string | null
): string[] {
  const tags = slotTagsFor(slot, value);
  return provider ? [...tags, `${PROVIDER_TAG_PREFIX}${provider}`] : tags;
}

/**
 * Garantidor normalizado pro formato das tags, ou null.
 *
 * Rótulo que slugifica pra vazio (só pontuação) conta como AUSENTE: melhor uma
 * cláusula genérica do que a tag `provider:` sem garantidor, que não casaria
 * com nada em `rankSlotCandidates` e sumiria da geração em silêncio.
 */
export function normalizeVariantProvider(provider: string | null | undefined): string | null {
  return slugifyProviderTag(provider) || null;
}

/** Chave de unicidade de uma variante: o par `(value, provider ?? null)`. */
function variantKey(value: string, provider: string | null): string {
  return `${value.trim().toLowerCase()}\u0000${provider ?? ""}`;
}

/**
 * Uma opção do form + um garantidor = uma cláusula. Repetir o PAR seria
 * ambíguo na geração (a resolução pega a mais recente e a outra vira lixo).
 *
 * O que mudou em relação à unicidade por `value` puro: as 4 minutas de
 * seguro-fiança da Ativa (Porto Seguro, Tokio Marine, Pottencial, TOO) são
 * todas `garantia:seguro_fianca` e só divergem no garantidor — recusá-las era
 * recusar o caso real.
 */
function assertUniqueVariants(
  slot: ClauseSlotKey,
  variants: readonly {
    value: string;
    provider: string | null;
    providerLabel: string | null;
  }[]
): void {
  const def = CLAUSE_SLOTS[slot];
  const seen = new Set<string>();
  for (const v of variants) {
    const key = variantKey(v.value, v.provider);
    if (seen.has(key)) {
      throw new ClauseIngestValidationError(
        v.provider
          ? `Duas variantes foram marcadas como "${def.valueLabel(v.value)}" com o ` +
            `garantidor "${v.providerLabel || v.provider}". Cada par opção + ` +
            `garantidor pode ter só uma cláusula.`
          : `Duas variantes foram marcadas como "${def.valueLabel(v.value)}" sem ` +
            `garantidor. Cada opção do formulário pode ter só uma cláusula genérica — ` +
            `informe o garantidor para diferenciá-las.`
      );
    }
    seen.add(key);
  }
}

/** Título default: o lote, o slot, a opção e (quando houver) o garantidor. */
function defaultTitle(
  slot: ClauseSlotKey,
  sourceName: string,
  value: string,
  providerLabel: string | null
): string {
  const def = CLAUSE_SLOTS[slot];
  const inner = providerLabel
    ? `${def.valueLabel(value)} — ${providerLabel}`
    : def.valueLabel(value);
  return `${sourceName} — ${def.label} (${inner})`;
}

// ────────────────────────────────────────────────────────────────────────────
// Gravação
// ────────────────────────────────────────────────────────────────────────────

/**
 * Superfície mínima do Prisma consumida aqui. `any` nos args porque a
 * assinatura genérica do PrismaClient não é atribuível a um parâmetro tipado
 * (contravariância) — mesmo padrão de `clause-slots.ts` e `upload-dedup.ts`.
 */
export type ClauseIngestTx = KnowledgeWriteClient & {
  knowledgeItem: {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    findMany: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
};

export type ClauseIngestDb = {
  $transaction: (
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    fn: (tx: ClauseIngestTx) => Promise<any>,
    opts?: { timeout?: number; maxWait?: number }
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  ) => Promise<any>;
};

/**
 * Arquiva o que esta variante substitui e devolve os ids arquivados.
 *
 * Duas etapas de propósito: o `hasEvery` do banco é filtro GROSSO (usa o índice
 * e reduz o conjunto), a igualdade de conjunto é a DECISÃO. Sem a segunda, a
 * primeira arquiva por subconjunto — ver o cabeçalho do módulo.
 */
async function archiveSupersededClauses(
  tx: ClauseIngestTx,
  orgId: string,
  tags: string[]
): Promise<string[]> {
  const candidates = (await tx.knowledgeItem.findMany({
    where: {
      orgId,
      category: "clause",
      status: "approved",
      tags: { hasEvery: tags },
    },
    select: { id: true, tags: true },
  })) as ArchiveCandidate[];

  const ids = selectExactTagMatches(candidates ?? [], tags);
  if (ids.length === 0) return [];

  await tx.knowledgeItem.updateMany({
    where: { id: { in: ids } },
    data: { status: "archived" },
  });
  return ids;
}

/**
 * Grava as cláusulas de um slot, tudo-ou-nada.
 *
 * Lança `ClauseIngestValidationError` (422) quando o payload é ambíguo; lança o
 * erro do Prisma quando a gravação falha — em ambos os casos NADA foi salvo (a
 * validação é pré-transação, a gravação é transacional).
 */
export async function ingestSlotClauses(
  input: IngestSlotClausesInput,
  db: ClauseIngestDb = prisma as unknown as ClauseIngestDb
): Promise<IngestSlotClausesResult> {
  const { orgId, slot, sourceName, variants } = input;

  // Garantidor normalizado uma vez só: a tag, a chave de unicidade e o título
  // têm que enxergar exatamente o mesmo valor.
  const prepared = variants.map((v) => {
    const provider = normalizeVariantProvider(v.provider);
    return {
      ...v,
      provider,
      providerLabel: provider ? (v.provider ?? "").trim() : null,
      tags: variantTags(slot, v.value, provider),
    };
  });

  assertUniqueVariants(slot, prepared);

  const { items, embedTargets } = (await db.$transaction(
    async (tx) => {
      const rows: IngestedClause[] = [];
      const targets: EmbedTarget[] = [];

      for (const variant of prepared) {
        const archivedIds = await archiveSupersededClauses(tx, orgId, variant.tags);

        const title = (
          variant.title?.trim() ||
          defaultTitle(slot, sourceName, variant.value, variant.providerLabel)
        ).slice(0, 300);

        const row = await createKnowledgeItemRows(
          {
            orgId,
            category: "clause",
            title,
            content: variant.content,
            tags: variant.tags,
            source: CLAUSE_INGEST_SOURCE,
            createdBy: input.createdBy ?? null,
          },
          tx
        );

        rows.push({
          id: row.parentId,
          title,
          value: variant.value,
          provider: variant.provider,
          tags: variant.tags,
          archivedIds,
        });
        targets.push(...row.embedTargets);
      }

      return { items: rows, embedTargets: targets };
    },
    { timeout: 30_000, maxWait: 10_000 }
  )) as { items: IngestedClause[]; embedTargets: EmbedTarget[] };

  return { slot, items, embedTargets };
}
