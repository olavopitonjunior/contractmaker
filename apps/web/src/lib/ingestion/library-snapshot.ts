/**
 * O que a biblioteca do tenant JÁ TEM — o contexto que faltava ao planner.
 *
 * Nos dois runs de staging o planner decidiu às cegas sobre o acervo: propôs
 * templates com o MESMO `matchCriteria` de modelos criados na véspera (nasceram
 * "(2)", e `pickTemplateByFacts` não teria como escolher entre os pares) e
 * cláusulas idênticas às que já aguardavam curadoria. Nada disso era erro de
 * julgamento — era falta de insumo: a biblioteca existente só entrava no dedup
 * por `sourceHash`, que enxerga bytes, não cobertura.
 *
 * Este módulo materializa o snapshot que o digest injeta na chamada e que os
 * guardrails usam como régua:
 *
 * - templates `active`/`draft` (nome, modalidade, matchCriteria) — para o
 *   planner descartar como `already_covered` o que já está coberto, e para o
 *   guardrail `library_collision` barrar o que colidiria;
 * - conjuntos de tags das cláusulas `approved`/`pending` — propor um conjunto
 *   que já existe é SUBSTITUIÇÃO (o mecanismo arquiva a anterior), então não é
 *   proibido; é informação para o planner só propor quando a redação do lote
 *   for melhor;
 * - as notas persistentes do operador (ver {@link readIngestionNotes}) — o
 *   comentário marcado "vale para os próximos lotes" vira parametrização do
 *   tenant em vez de instrução repetida a cada run.
 */

import { prisma } from "@/lib/db/prisma";
import { parseMatchCriteria } from "@/lib/contracts/template-category";
import { CLAUSE_SLOT_KEYS } from "@/lib/templates/clause-slots";
import type { PlannedMatchCriteria } from "./library-plan";

export interface LibraryTemplateSummary {
  name: string;
  modalidade: string;
  status: "active" | "draft";
  isDefault: boolean;
  matchCriteria: PlannedMatchCriteria;
}

export interface LibrarySnapshot {
  templates: LibraryTemplateSummary[];
  /** Conjuntos de tags (já canônicos) das cláusulas approved+pending. */
  clauseTagSets: string[][];
  /** Instruções persistentes do operador deste tenant, já saneadas. */
  operatorNotes: string[];
}

export const EMPTY_LIBRARY_SNAPSHOT: LibrarySnapshot = {
  templates: [],
  clauseTagSets: [],
  operatorNotes: [],
};

/** Flag de `OrgModule.featureFlags` onde as notas persistentes moram. */
export const INGESTION_NOTES_FLAG = "locacao.ingestao_notas";

/** Caps das notas: além disso vira ruído de prompt, não parametrização. */
export const MAX_NOTES = 20;
export const MAX_NOTE_CHARS = 300;

export interface IngestionNote {
  text: string;
  author: string;
  at: string;
}

/**
 * Lê as notas persistentes do JSON de featureFlags. Texto de usuário que vai
 * PARA DENTRO de um prompt: além dos caps, remove quebras de linha e crases —
 * uma nota não pode abrir seção nova nem bloco de código no digest.
 */
export function readIngestionNotes(featureFlags: unknown): string[] {
  if (!featureFlags || typeof featureFlags !== "object") return [];
  const raw = (featureFlags as Record<string, unknown>)[INGESTION_NOTES_FLAG];
  if (!Array.isArray(raw)) return [];
  const notes: string[] = [];
  for (const entry of raw.slice(0, MAX_NOTES)) {
    const text =
      typeof entry === "string"
        ? entry
        : typeof (entry as IngestionNote)?.text === "string"
          ? (entry as IngestionNote).text
          : null;
    if (!text) continue;
    const clean = text
      .replace(/[\r\n`#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NOTE_CHARS);
    if (clean) notes.push(clean);
  }
  return notes;
}

/** Ordena e deduplica um conjunto de tags — a MESMA identidade do acervo. */
export function canonicalTagSet(tags: readonly string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).sort();
}

/**
 * Carrega o snapshot da biblioteca do tenant. Uma leitura por run (o planner
 * pode rodar vários degraus, mas o snapshot do início do planejamento vale para
 * a escada inteira — a biblioteca não muda no meio de um run).
 */
export async function loadLibrarySnapshot(orgId: string): Promise<LibrarySnapshot> {
  const [templates, clauses, module_] = await Promise.all([
    prisma.contractTemplate.findMany({
      where: { orgId, status: { in: ["active", "draft"] } },
      select: {
        name: true,
        modalidade: true,
        status: true,
        isDefault: true,
        matchCriteria: true,
      },
      orderBy: [{ modalidade: "asc" }, { name: "asc" }],
    }),
    prisma.knowledgeItem.findMany({
      where: {
        orgId,
        category: "clause",
        status: { in: ["approved", "pending"] },
        tags: { hasSome: CLAUSE_SLOT_KEYS.map((k) => `slot:${k}`) },
      },
      select: { tags: true },
    }),
    // As notas moram no módulo de locação — mesmo lugar da flag da ingestão.
    prisma.orgModule.findFirst({
      where: { orgId, module: "locacao" },
      select: { featureFlags: true },
    }),
  ]);

  return {
    // Template sem modalidade não disputa seleção nenhuma — fora da régua.
    templates: templates.flatMap((t) =>
      t.modalidade
        ? [
            {
              name: t.name,
              modalidade: t.modalidade,
              status: t.status as "active" | "draft",
              isDefault: t.isDefault,
              matchCriteria: (parseMatchCriteria(t.matchCriteria) ??
                {}) as PlannedMatchCriteria,
            },
          ]
        : []
    ),
    clauseTagSets: Array.from(
      new Map(
        (clauses as Array<{ tags: string[] }>).map((c) => {
          const set = canonicalTagSet(c.tags);
          return [set.join("|"), set] as const;
        })
      ).values()
    ),
    operatorNotes: readIngestionNotes(module_?.featureFlags),
  };
}
