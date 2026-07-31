/**
 * Seed do ACERVO DE CLÁUSULAS CURADAS de um tenant — grava um pacote de
 * cláusulas revisadas (`_index.json` + `*.json`) como `KnowledgeItem`
 * `category="clause"` / `status="approved"` / `source="seed_curado"` da org.
 *
 * Pra que serve: fecha a consolidação de modelos. O template consolidado declara
 * `{{{slot_garantia}}}` e, na geração, `resolveClauseSlots` casa a escolha do
 * formulário com as TAGS da cláusula (`slot:garantia` + `garantia:<tipo>`
 * [+ `provider:<x>` + `cobertura:<y>`]) e injeta o texto. Este script é o
 * caminho de mão única que leva o pacote curado (fora do repo, revisado pela
 * imobiliária) pro acervo da org.
 *
 * Diferença pros irmãos:
 *   - `seed-tenant-templates.ts` grava `ContractTemplate` (o documento).
 *   - `seed-locacao-clauses.ts` grava o acervo GENÉRICO da Lei 8.245 (catálogo
 *     versionado em `lib/knowledge/seed-clauses-locacao.ts`, idempotente por
 *     título).
 *   - este grava o acervo CURADO DE UM TENANT, lido de um diretório passado no
 *     `--dir`, idempotente por CONJUNTO DE TAGS (que é o que o resolver de slot
 *     consulta) — não por título.
 *
 * Uso:
 *   npx tsx scripts/seed-acervo-clausulas.ts --org <orgId|slug> --dir <pacote>            # dry-run
 *   npx tsx scripts/seed-acervo-clausulas.ts --org <orgId|slug> --dir <pacote> --apply    # persiste
 *
 * Flags:
 *   --org <orgId|slug>   obrigatório. Aceita o cuid ou o slug da Organization.
 *   --dir <caminho>      obrigatório. Pasta do pacote (a que contém `clausulas/`)
 *                        OU a própria pasta `clausulas/`. Absoluto ou relativo
 *                        ao cwd.
 *   --dry-run            default (redundante; explicitar é permitido).
 *   --apply              escreve no banco.
 *
 * Env:
 *   DATABASE_URL   — Prisma (passe a URL de staging/prod inline).
 *   VOYAGE_API_KEY — opcional. Sem ele o seed roda igual e avisa: as cláusulas
 *                    ficam sem vetor (busca cai no ILIKE). O resolver de slot
 *                    NÃO usa embedding — casa por tag —, então a ausência não
 *                    afeta a geração de contrato, só a busca semântica.
 *
 * Idempotência (chave = CONJUNTO EXATO DE TAGS do arquivo):
 *   - nenhum item approved da org com aquele conjunto  → CREATE;
 *   - um item, mesmo título, mesmo conteúdo            → UNCHANGED;
 *   - um item, mesmo título, conteúdo mudou            → UPDATE in-place
 *                                                        (re-embute);
 *   - um item, título diferente                        → ARCHIVE + CREATE;
 *   - vários itens approved no mesmo conjunto          → ARCHIVE todos + CREATE.
 *
 *   O ARCHIVE (em vez de delete) segue o precedente de
 *   `POST /api/templates/ingest/clauses`: o resolver pega por tag entre os
 *   `approved`, então não pode haver dois vivos no mesmo conjunto — mas nada se
 *   perde, o antigo vira `status="archived"`.
 *
 * NÃO usa transação interativa: é CLI contra Neon, e segurar uma transação por
 * 20 cláusulas × chamada de rede é receita de timeout. A ordem por cláusula
 * (archive → create) mantém a invariante "no máximo um approved por conjunto de
 * tags" mesmo se o processo morrer no meio — o pior caso é uma cláusula
 * arquivada sem substituta, que o próximo `--apply` recria.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  createKnowledgeItemRows,
  embedKnowledgeItem,
  normalizeKnowledgeContent,
  updateKnowledgeItem,
  type EmbedTarget,
} from "@/lib/ai/knowledge";
import { isEmbeddingsConfigured } from "@/lib/ai/embeddings";
import { chunkText } from "@/lib/ai/chunking";

/** `KnowledgeItem.source` das linhas gravadas por este script. */
export const CURATED_CLAUSE_SOURCE = "seed_curado";

// ---------------------------------------------------------------------------
// Shape do pacote curado
// ---------------------------------------------------------------------------

/**
 * Uma cláusula curada em disco. O pacote real traz mais campos que o mínimo
 * (`groupCode`, `subcategory`, `source`, `notes`) — todos mapeados pro
 * `KnowledgeItem`, nenhum obrigatório exceto os três do contrato mínimo
 * (`title`, `content`, `tags`).
 */
const curatedClauseSchema = z.object({
  /** Estável, casa com o `_index.json`. Só usado pra log/cross-check. */
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(20),
  /** Conjunto de tags = a CHAVE de identidade no acervo. */
  tags: z.array(z.string().trim().min(1)).min(1),
  /** Sempre "clause" no pacote; recusamos qualquer outra coisa. */
  category: z.literal("clause").optional(),
  subcategory: z.string().trim().min(1).nullable().optional(),
  groupCode: z.string().trim().min(1).nullable().optional(),
  /** Rótulo de proveniência do curador (ex.: "RESIDENCIAL TOO"). */
  source: z.string().trim().min(1).nullable().optional(),
  /** Observações do curador → `KnowledgeItem.agentNotes`. */
  notes: z.string().trim().min(1).nullable().optional(),
});

export type CuratedClause = z.infer<typeof curatedClauseSchema> & { file: string };

const indexEntrySchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).min(1),
  /** Caminho relativo à RAIZ do pacote (ex.: `clausulas/x.json`). */
  file: z.string().trim().min(1),
});

const indexSchema = z.array(indexEntrySchema).min(1);

export type CuratedIndexEntry = z.infer<typeof indexEntrySchema>;

// ---------------------------------------------------------------------------
// Leitura + validação (puro o suficiente pra testar)
// ---------------------------------------------------------------------------

function readJson(file: string): unknown {
  const raw = fs.readFileSync(file, "utf-8").replace(/^﻿/, "");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `JSON inválido em ${file}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Valida o shape de UM arquivo de cláusula. Erro = shape fora do contrato. */
export function parseCuratedClause(raw: unknown, file: string): CuratedClause {
  const parsed = curatedClauseSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Cláusula inválida em ${file} — ${issues}`);
  }
  if (parsed.data.category && parsed.data.category !== "clause") {
    throw new Error(`Cláusula ${file}: category deve ser "clause".`);
  }
  return { ...parsed.data, file };
}

/**
 * Resolve o `--dir` pro `_index.json` e pra função que acha cada arquivo.
 * Aceita a raiz do pacote (que contém `clausulas/`) ou a própria `clausulas/`.
 */
export function resolvePackage(dirArg: string): {
  root: string;
  indexPath: string;
  resolveFile: (relFile: string) => string;
} {
  const dir = path.isAbsolute(dirArg) ? dirArg : path.resolve(process.cwd(), dirArg);
  if (!fs.existsSync(dir)) throw new Error(`Pasta do pacote não encontrada: ${dir}`);

  // `clausulas/_index.json` (raiz do pacote) tem precedência sobre `_index.json`
  // (a pasta já é a de cláusulas) — se as duas existirem, a raiz é a canônica.
  const nested = path.join(dir, "clausulas", "_index.json");
  const flat = path.join(dir, "_index.json");

  if (fs.existsSync(nested)) {
    return {
      root: dir,
      indexPath: nested,
      resolveFile: (rel) => resolveEntryFile(dir, path.join(dir, "clausulas"), rel),
    };
  }
  if (fs.existsSync(flat)) {
    // `--dir <pacote>/clausulas`: os `file` do índice são relativos ao PAI.
    const root = path.dirname(dir);
    return {
      root,
      indexPath: flat,
      resolveFile: (rel) => resolveEntryFile(root, dir, rel),
    };
  }
  throw new Error(`_index.json não encontrado em ${dir} nem em ${nested}`);
}

/** `clausulas/x.json` a partir da raiz; fallback pro basename na pasta do índice. */
function resolveEntryFile(root: string, indexDir: string, rel: string): string {
  const fromRoot = path.resolve(root, rel);
  if (fs.existsSync(fromRoot)) return fromRoot;
  const fromIndexDir = path.join(indexDir, path.basename(rel));
  if (fs.existsSync(fromIndexDir)) return fromIndexDir;
  throw new Error(`Arquivo do índice não encontrado: ${rel} (tentei ${fromRoot})`);
}

/** Lê `_index.json` + cada arquivo, valida shape e coerência índice×arquivo. */
export function loadCuratedPackage(dirArg: string): {
  root: string;
  indexPath: string;
  clauses: CuratedClause[];
} {
  const { root, indexPath, resolveFile } = resolvePackage(dirArg);
  const index = indexSchema.parse(readJson(indexPath));

  const clauses: CuratedClause[] = [];
  const seenIds = new Set<string>();
  for (const entry of index) {
    if (seenIds.has(entry.id)) {
      throw new Error(`_index.json: id duplicado "${entry.id}".`);
    }
    seenIds.add(entry.id);

    const file = resolveFile(entry.file);
    const clause = parseCuratedClause(readJson(file), file);
    if (clause.id !== entry.id) {
      throw new Error(`${file}: id "${clause.id}" diverge do índice ("${entry.id}").`);
    }
    if (clause.title !== entry.title) {
      throw new Error(
        `${file}: title diverge do índice.\n  arquivo: ${clause.title}\n  índice:  ${entry.title}`
      );
    }
    if (!sameTagSet(clause.tags, entry.tags)) {
      throw new Error(
        `${file}: tags divergem do índice.\n  arquivo: ${clause.tags.join(", ")}\n  índice:  ${entry.tags.join(", ")}`
      );
    }
    clauses.push(clause);
  }

  // Duas cláusulas com o MESMO conjunto de tags brigariam pelo mesmo slot — o
  // resolver pegaria uma delas por desempate de `updatedAt`/`id`. Fatal.
  const byKey = new Map<string, CuratedClause>();
  for (const c of clauses) {
    const key = tagIdentity(c.tags);
    const clash = byKey.get(key);
    if (clash) {
      throw new Error(
        `Conjunto de tags repetido no pacote: [${key}]\n  ${clash.id}\n  ${c.id}\n` +
          `  Cada conjunto de tags só pode ter UMA cláusula approved.`
      );
    }
    byKey.set(key, c);
  }

  return { root, indexPath, clauses };
}

// ---------------------------------------------------------------------------
// Identidade por tags
// ---------------------------------------------------------------------------

/**
 * Chave canônica de um conjunto de tags (ordem-insensível, sem duplicata).
 * É a IDENTIDADE da cláusula no acervo: `slot:garantia|garantia:seguro_fianca|
 * provider:pottencial|cobertura:pintura`.
 */
export function tagIdentity(tags: string[]): string {
  return Array.from(new Set(tags)).sort().join("|");
}

/** Dois conjuntos de tags são o mesmo (ordem e repetição não contam). */
export function sameTagSet(a: string[], b: string[]): boolean {
  return tagIdentity(a) === tagIdentity(b);
}

// ---------------------------------------------------------------------------
// Varredura de PII
// ---------------------------------------------------------------------------

/** CPF formatado. CNPJ de PJ (garantidoras/seguradoras) NÃO é PII pessoal. */
const CPF_RE = /\d{3}\.\d{3}\.\d{3}-\d{2}/g;
/** Placeholder legítimo em modelo/cláusula — não é CPF de ninguém. */
const CPF_PLACEHOLDER = "000.000.000-00";

export interface CpfHit {
  file: string;
  clauseId: string;
  field: "content" | "title" | "notes";
  match: string;
}

/**
 * Sanidade anti-vazamento: cláusula curada NÃO pode carregar CPF de cliente
 * real. CNPJ passa de propósito — a redação das garantidoras (Loft, Almada,
 * seguradoras) cita o CNPJ da PJ e isso é parte do texto contratual.
 */
export function scanForCpf(clauses: CuratedClause[]): CpfHit[] {
  const hits: CpfHit[] = [];
  for (const c of clauses) {
    const fields: Array<[CpfHit["field"], string | null | undefined]> = [
      ["title", c.title],
      ["content", c.content],
      ["notes", c.notes],
    ];
    for (const [field, value] of fields) {
      if (!value) continue;
      for (const m of value.match(CPF_RE) ?? []) {
        if (m === CPF_PLACEHOLDER) continue;
        hits.push({ file: c.file, clauseId: c.id, field, match: m });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Planejamento (puro)
// ---------------------------------------------------------------------------

/** Linha existente no acervo, do jeito que a consulta traz. */
export interface ExistingClauseRow {
  id: string;
  title: string;
  content: string;
  tags: string[];
  chunkIndex: number;
  chunkTotal: number;
  parentId: string | null;
}

export type SeedActionKind = "create" | "update" | "archive_create" | "unchanged";

export interface SeedAction {
  clause: CuratedClause;
  kind: SeedActionKind;
  /** Ids RAIZ a arquivar antes de gravar (os chunks vão junto). */
  archiveIds: string[];
  /** Row a atualizar in-place (só em `kind === "update"`). */
  updateId?: string;
  /**
   * Em quantos chunks o EMBEDDING repartiria o conteúdo. Não afeta o que é
   * gravado (cláusula de slot é sempre row única, via `noChunk`) — serve só pra
   * avisar que o vetor cobre apenas o 1º pedaço.
   */
  chunkCount: number;
  /** Por que não foi um update simples. */
  reason?: string;
}

/**
 * Conteúdo em disco bate com o que está gravado?
 *
 * Compara contra o conteúdo NORMALIZADO (não contra o `content` cru), que é
 * exatamente o que `createKnowledgeItemRows` grava com `noChunk` — senão um
 * `\r\n` ou espaço na ponta faria o seed "atualizar" a mesma cláusula em toda
 * rodada.
 *
 * Row legada CHUNKADA nunca bate: o `content` da raiz lá é um preview de 500
 * chars. Ela é arquivada e recriada como row única.
 */
export function matchesStoredContent(
  clause: CuratedClause,
  parent: ExistingClauseRow,
  children: ExistingClauseRow[]
): boolean {
  const content = normalizeKnowledgeContent(clause.content);
  if (!content) return false;
  if (parent.chunkTotal !== 1 || children.length > 0) return false;
  return parent.content === content;
}

/**
 * Decide o que fazer com cada cláusula do pacote. Puro: recebe o acervo já
 * carregado e devolve o plano — o CLI só executa.
 */
export function planClauseSeed(
  clauses: CuratedClause[],
  existing: ExistingClauseRow[]
): SeedAction[] {
  const roots = existing.filter((r) => r.parentId === null);
  const childrenByParent = new Map<string, ExistingClauseRow[]>();
  for (const row of existing) {
    if (!row.parentId) continue;
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row);
    childrenByParent.set(row.parentId, list);
  }

  return clauses.map((clause) => {
    const chunkCount = chunkText(clause.content).length;
    const matches = roots.filter((r) => sameTagSet(r.tags, clause.tags));

    if (matches.length === 0) {
      return { clause, kind: "create" as const, archiveIds: [], chunkCount };
    }

    if (matches.length > 1) {
      return {
        clause,
        kind: "archive_create" as const,
        archiveIds: matches.map((m) => m.id),
        chunkCount,
        reason: `${matches.length} cláusulas approved no mesmo conjunto de tags (ambíguo pro resolver)`,
      };
    }

    const hit = matches[0];
    if (hit.title !== clause.title) {
      return {
        clause,
        kind: "archive_create" as const,
        archiveIds: [hit.id],
        chunkCount,
        reason: `título mudou (antigo: "${hit.title}")`,
      };
    }

    if (matchesStoredContent(clause, hit, childrenByParent.get(hit.id) ?? [])) {
      return { clause, kind: "unchanged" as const, archiveIds: [], chunkCount };
    }

    // Mesmo título, conteúdo diferente. Row única dá pra atualizar no lugar (a
    // lib re-embute). Row LEGADA chunkada não: as filhas herdam as tags e
    // envenenam o resolver, então arquiva (parent + filhas) e recria íntegra.
    if (hit.chunkTotal === 1) {
      return {
        clause,
        kind: "update" as const,
        archiveIds: [],
        updateId: hit.id,
        chunkCount,
      };
    }
    return {
      clause,
      kind: "archive_create" as const,
      archiveIds: [hit.id],
      chunkCount,
      reason: `linha legada repartida em ${hit.chunkTotal} chunks (recriar como row única)`,
    };
  });
}

// ---------------------------------------------------------------------------
// Mapeamento pro KnowledgeItem
// ---------------------------------------------------------------------------

/**
 * `agentNotes` da row: proveniência do curador + observações. Determinístico
 * (entra igual em toda rodada).
 */
export function buildAgentNotes(clause: CuratedClause): string | null {
  const parts: string[] = [];
  if (clause.source) parts.push(`Origem: ${clause.source}`);
  if (clause.notes) parts.push(clause.notes);
  return parts.length ? parts.join("\n\n") : null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

const KIND_LABEL: Record<SeedActionKind, string> = {
  create: "＋ CREATE",
  update: "⚡ UPDATE",
  archive_create: "♻ ARCHIVE+CREATE",
  unchanged: "✓ UNCHANGED",
};

const USAGE =
  "  npx tsx scripts/seed-acervo-clausulas.ts --org <orgId|slug> --dir <pacote> [--apply]";

async function main() {
  const DRY_RUN = !process.argv.includes("--apply");
  const org = argValue("--org");
  const dirArg = argValue("--dir");

  if (!org || !dirArg) {
    console.error(
      `[seed-acervo-clausulas] --org <orgId|slug> e --dir <pacote> são obrigatórios.\n${USAGE}`
    );
    process.exit(1);
  }

  console.log(`[seed-acervo-clausulas] ${DRY_RUN ? "DRY RUN" : "APPLY MODE"}`);
  console.log(`[seed-acervo-clausulas] org (arg): ${org}`);

  // 1) Disco primeiro — pacote quebrado falha barato, sem tocar no banco.
  const { root, indexPath, clauses } = loadCuratedPackage(dirArg);
  console.log(`[seed-acervo-clausulas] pacote: ${root}`);
  console.log(`[seed-acervo-clausulas] índice: ${indexPath} (${clauses.length} cláusulas)`);

  // 2) Varredura de PII. CNPJ de PJ passa (é texto contratual); CPF não.
  const cpfHits = scanForCpf(clauses);
  if (cpfHits.length > 0) {
    console.error(
      `\n[seed-acervo-clausulas] ABORTADO: ${cpfHits.length} CPF(s) no pacote curado.`
    );
    for (const h of cpfHits) {
      console.error(`  ${h.clauseId} (${h.field}): ${h.match}  — ${h.file}`);
    }
    console.error(
      "  Remova/anonimize antes de semear. (O placeholder 000.000.000-00 é aceito.)"
    );
    process.exit(1);
  }
  console.log(`[seed-acervo-clausulas] varredura de CPF: limpa`);

  // Cláusula longa NÃO é mais risco de conteúdo: o seed grava row única com o
  // texto integral (`noChunk`). O que passa de ~3200 chars perde só ALCANCE DE
  // BUSCA — o vetor cobre o 1º pedaço. O slot casa por TAG, então não é afetado.
  const longas = clauses.filter((c) => chunkText(c.content).length > 1);
  if (longas.length > 0) {
    console.log(
      `\n[seed-acervo-clausulas] nota: ${longas.length} cláusula(s) passam de ~3200 chars.` +
        ` O conteúdo é gravado INTEIRO numa row só; o embedding cobre apenas o 1º` +
        ` trecho (busca semântica menos precisa nelas — o slot casa por tag e não muda):`
    );
    for (const c of longas) {
      console.log(
        `  - ${c.id}: ${c.content.length} chars → vetor sobre ~${chunkText(c.content)[0].text.length}`
      );
    }
  }

  console.log(
    `[seed-acervo-clausulas] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@") ?? "(sem DATABASE_URL)"}`
  );
  console.log(
    `[seed-acervo-clausulas] embeddings: ${isEmbeddingsConfigured() ? "ON (Voyage)" : "OFF — sem VOYAGE_API_KEY, cláusulas ficam sem vetor (busca cai no ILIKE; o slot casa por tag e não é afetado)"}`
  );
  console.log();

  // 3) Banco.
  try {
    const organization = await prisma.organization.findFirst({
      where: { OR: [{ id: org }, { slug: org }] },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) {
      throw new Error(`Organization não encontrada por id nem slug: "${org}"`);
    }
    const orgId = organization.id;
    console.log(
      `[seed-acervo-clausulas] org: ${organization.name} (id=${orgId}, slug=${organization.slug})`
    );

    // Superconjunto: qualquer row com identidade IGUAL compartilha ao menos uma
    // tag do pacote, então `hasSome` não perde candidato. O casamento exato é
    // feito em memória (`sameTagSet`) — `hasEvery` traria também as cláusulas
    // MAIS específicas (ex.: a de `cobertura:pintura` ao procurar a de
    // `provider:porto_seguro`) e arquivaria o que não devia.
    const allTags = Array.from(new Set(clauses.flatMap((c) => c.tags)));
    const existing = (await prisma.knowledgeItem.findMany({
      where: {
        orgId,
        category: "clause",
        status: "approved",
        tags: { hasSome: allTags },
      },
      select: {
        id: true,
        title: true,
        content: true,
        tags: true,
        chunkIndex: true,
        chunkTotal: true,
        parentId: true,
      },
    })) as ExistingClauseRow[];
    console.log(
      `[seed-acervo-clausulas] acervo atual: ${existing.length} linha(s) approved tocando essas tags`
    );
    console.log();

    const plan = planClauseSeed(clauses, existing);
    const embedTargets: EmbedTarget[] = [];
    const tally: Record<SeedActionKind, number> = {
      create: 0,
      update: 0,
      archive_create: 0,
      unchanged: 0,
    };

    for (const action of plan) {
      const { clause } = action;
      tally[action.kind] += 1;
      console.log(
        `${KIND_LABEL[action.kind]}  ${clause.id}` +
          `\n    título: ${clause.title}` +
          `\n    tags:   [${tagIdentity(clause.tags)}]` +
          `\n    conteúdo: ${clause.content.length} chars (row única)` +
          (action.chunkCount > 1 ? ` — vetor só do 1º trecho` : "") +
          (action.reason ? `\n    motivo: ${action.reason}` : "") +
          (action.archiveIds.length
            ? `\n    arquiva: ${action.archiveIds.join(", ")}`
            : "") +
          (action.updateId ? `\n    atualiza: ${action.updateId}` : "")
      );

      if (DRY_RUN || action.kind === "unchanged") continue;

      // Archive: o parent e os chunks dele. `status="archived"` some do resolver
      // (que filtra approved) sem perder o histórico.
      if (action.archiveIds.length > 0) {
        const archived = await prisma.knowledgeItem.updateMany({
          where: {
            orgId,
            OR: [
              { id: { in: action.archiveIds } },
              { parentId: { in: action.archiveIds } },
            ],
          },
          data: { status: "archived" },
        });
        console.log(`    ✓ arquivadas ${archived.count} linha(s)`);
      }

      if (action.kind === "update" && action.updateId) {
        // Row única: a lib atualiza e re-embute. Gravamos o texto NORMALIZADO
        // (integral) pra bater com o que o create grava — idempotência estável.
        await updateKnowledgeItem(action.updateId, orgId, {
          title: clause.title,
          content: normalizeKnowledgeContent(clause.content),
          tags: clause.tags,
          source: CURATED_CLAUSE_SOURCE,
          agentNotes: buildAgentNotes(clause),
          groupCode: clause.groupCode ?? null,
          subcategory: clause.subcategory ?? null,
          status: "approved",
        });
        console.log(`    ✓ atualizada (id=${action.updateId})`);
        continue;
      }

      const { parentId, embedTargets: targets } = await createKnowledgeItemRows({
        orgId,
        category: "clause",
        title: clause.title,
        content: clause.content,
        tags: clause.tags,
        source: CURATED_CLAUSE_SOURCE,
        agentNotes: buildAgentNotes(clause),
        groupCode: clause.groupCode ?? null,
        subcategory: clause.subcategory ?? null,
        status: "approved",
        // Row ÚNICA com o texto integral. Cláusula de slot é lida de volta
        // inteira pro contrato — chunkar deixava o resolver pegar o preview de
        // 500 chars ou um pedaço do meio (casos reais: Pottencial 3260 chars,
        // Loft 6660). As tags `slot:*` já ligariam isto sozinhas; explícito
        // aqui porque o pacote curado é sempre conteúdo de slot.
        noChunk: true,
      });
      embedTargets.push(...targets);
      console.log(`    ✓ criada (id=${parentId}, ${targets.length} linha(s) a embutir)`);
    }

    // 4) Embeddings num lote só, FORA de qualquer transação (Voyage é rede).
    // Best-effort: falhar aqui não invalida o seed — as cláusulas já estão no
    // acervo e o resolver de slot casa por tag, não por vetor.
    if (!DRY_RUN && embedTargets.length > 0) {
      if (!isEmbeddingsConfigured()) {
        console.log(
          `\n[seed-acervo-clausulas] sem VOYAGE_API_KEY — ${embedTargets.length} linha(s) ficam sem vetor.`
        );
      } else {
        try {
          await embedKnowledgeItem(embedTargets, { orgId });
          console.log(`\n[seed-acervo-clausulas] embeddings: ${embedTargets.length} linha(s) OK`);
        } catch (err) {
          console.warn(
            `\n[seed-acervo-clausulas] AVISO: embedding falhou (${err instanceof Error ? err.message : String(err)}).` +
              ` As cláusulas foram gravadas; rode de novo pra tentar o vetor.`
          );
        }
      }
    }

    console.log();
    console.log(
      `[seed-acervo-clausulas] ${DRY_RUN ? "would create" : "created"}: ${tally.create}, ` +
        `${DRY_RUN ? "would update" : "updated"}: ${tally.update}, ` +
        `${DRY_RUN ? "would archive+create" : "archived+created"}: ${tally.archive_create}, ` +
        `unchanged: ${tally.unchanged}`
    );
    if (DRY_RUN && tally.create + tally.update + tally.archive_create > 0) {
      console.log(`[seed-acervo-clausulas] Rode com --apply pra persistir.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[seed-acervo-clausulas] ERROR:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
