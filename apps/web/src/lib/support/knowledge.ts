/**
 * Busca na base de conhecimento de suporte.
 *
 * Espelha lib/ai/tool-handlers.ts::handleQueryKnowledgeBase, mas fixando
 * category="support" + o orgId de plataforma, e filtrando por tags de módulo
 * (o tenant só vê conteúdo dos módulos que tem habilitados + "geral").
 * Semântico (Voyage + pgvector <=>) quando configurado; senão, fallback ILIKE.
 */

import { prisma } from "@/lib/db/prisma";
import {
  embedOne,
  toPgVector,
  isEmbeddingsConfigured,
  VoyageError,
} from "@/lib/ai/embeddings";
import { SUPPORT_CATEGORY, isSupportModuleTag, type SupportModuleTag } from "./constants";
import { resolveSupportOrgId } from "./org";

export interface SupportHit {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: string | null;
  similarity: number | null;
}

export interface SupportSearchResult {
  results: SupportHit[];
  mode: "semantic" | "keyword_fallback";
  /** Maior similaridade entre os hits (null no fallback ou sem resultados). */
  topSimilarity: number | null;
}

const STOPWORDS = new Set([
  "para",
  "como",
  "onde",
  "qual",
  "quais",
  "quando",
  "sobre",
  "esse",
  "essa",
  "isso",
  "meu",
  "minha",
  "dele",
  "dela",
  "com",
  "por",
  "que",
  "uma",
  "não",
  "nao",
  "the",
  "and",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Array literal SQL seguro a partir de tags whitelisted (sem injeção). */
function sqlTagArray(tags: SupportModuleTag[]): string {
  const safe = tags.filter(isSupportModuleTag);
  const list = (safe.length ? safe : ["geral"]).map((t) => `'${t}'`).join(",");
  return `ARRAY[${list}]::text[]`;
}

async function keywordFallback(
  query: string,
  topK: number,
  orgId: string,
  moduleTags: SupportModuleTag[]
): Promise<SupportSearchResult> {
  const tags = moduleTags.filter(isSupportModuleTag);
  const tokens = Array.from(
    new Set(
      normalize(query)
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
    )
  );

  const baseWhere = {
    orgId,
    category: SUPPORT_CATEGORY,
    ...(tags.length ? { tags: { hasSome: tags } } : {}),
  } as const;

  const select = { id: true, title: true, content: true, tags: true, source: true } as const;

  if (tokens.length === 0) {
    const rows = await prisma.knowledgeItem.findMany({
      where: {
        ...baseWhere,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      take: topK,
      orderBy: { updatedAt: "desc" },
      select,
    });
    return {
      results: rows.map((r) => ({ ...r, content: r.content.slice(0, 800), similarity: null })),
      mode: "keyword_fallback",
      topSimilarity: null,
    };
  }

  const candidates = await prisma.knowledgeItem.findMany({
    where: {
      ...baseWhere,
      OR: tokens.flatMap((t) => [
        { title: { contains: t, mode: "insensitive" as const } },
        { content: { contains: t, mode: "insensitive" as const } },
        { tags: { has: t } },
      ]),
    },
    take: 50,
    select,
  });

  const scored = candidates
    .map((r) => {
      const hay = normalize(`${r.title} ${r.content} ${(r.tags ?? []).join(" ")}`);
      const score = tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    results: scored.map(({ r }) => ({ ...r, content: r.content.slice(0, 800), similarity: null })),
    mode: "keyword_fallback",
    topSimilarity: null,
  };
}

export async function searchSupportKnowledge(
  query: string,
  opts: { topK?: number; moduleTags?: SupportModuleTag[] } = {}
): Promise<SupportSearchResult> {
  const q = (query || "").trim();
  const topK = Math.min(opts.topK && opts.topK > 0 ? Math.floor(opts.topK) : 5, 10);
  // "geral" sempre incluído: conteúdo agnóstico de módulo é visível a todos.
  const moduleTags = Array.from(
    new Set<SupportModuleTag>(["geral", ...(opts.moduleTags ?? [])])
  );
  const orgId = await resolveSupportOrgId();

  if (!q) return { results: [], mode: "keyword_fallback", topSimilarity: null };

  // Observabilidade: base vazia pra uma pergunta costuma ser mismatch de org
  // (seed num banco/org diferente do runtime) — logamos o orgId resolvido pra
  // diagnosticar via Vercel logs sem precisar acessar o banco.
  const logResult = (r: SupportSearchResult) => {
    if (r.results.length === 0) {
      console.warn(
        `[searchSupportKnowledge] 0 hits — orgId=${orgId} mode=${r.mode} q="${q.slice(0, 60)}"`
      );
    }
    return r;
  };

  if (!isEmbeddingsConfigured()) {
    return logResult(await keywordFallback(q, topK, orgId, moduleTags));
  }

  try {
    const queryVec = await embedOne(q, "query", { orgId, operation: "embed_query" });
    const vecLiteral = toPgVector(queryVec);

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        title: string;
        content: string;
        tags: string[];
        source: string | null;
        similarity: number;
      }>
    >(
      `
      SELECT id, title, content, tags, source,
             1 - (embedding <=> $1::vector) AS similarity
      FROM "KnowledgeItem"
      WHERE "orgId" = $2
        AND category = $3
        AND embedding IS NOT NULL
        AND tags && ${sqlTagArray(moduleTags)}
      ORDER BY embedding <=> $1::vector
      LIMIT ${topK}
      `,
      vecLiteral,
      orgId,
      SUPPORT_CATEGORY
    );

    const results = rows.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content.slice(0, 800),
      tags: r.tags,
      source: r.source,
      similarity: Number(r.similarity?.toFixed?.(3) ?? r.similarity),
    }));

    return logResult({
      results,
      mode: "semantic",
      topSimilarity: results.length ? results[0].similarity : null,
    });
  } catch (err) {
    const reason =
      err instanceof VoyageError
        ? `Voyage: ${err.message}`
        : err instanceof Error
        ? err.message.slice(0, 160)
        : String(err).slice(0, 160);
    console.error("[searchSupportKnowledge] fallback acionado:", reason);
    return logResult(await keywordFallback(q, topK, orgId, moduleTags));
  }
}
