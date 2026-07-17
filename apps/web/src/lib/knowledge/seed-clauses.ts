import { prisma } from "@/lib/db/prisma";
import {
  createKnowledgeItemRows,
  embedKnowledgeItem,
  type EmbedTarget,
} from "@/lib/ai/knowledge";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";
import {
  LOCACAO_SEED_CLAUSES,
  LOCACAO_SEED_SOURCE,
} from "./seed-clauses-locacao";
import {
  VENDAS_SEED_CLAUSES,
  VENDAS_SEED_SOURCE,
} from "./seed-clauses-vendas";

/**
 * Semeia a biblioteca-base de cláusulas (`KnowledgeItem category="clause"`)
 * pra uma org, escolhendo os bancos pelos MÓDULOS habilitados:
 *   - Vendas ON  → banco CCV G1..G6 (23 cláusulas)
 *   - Locação ON → banco Lei 8.245/91
 *
 * Idempotente por (orgId, category:"clause", title) — reexecutar só cria as
 * que faltam. Embedding em background pelo caller (retorna os targets).
 *
 * Compartilhado por: `/api/knowledge/seed-defaults` (botão do onboarding) e
 * `/api/admin/orgs` (semeadura opt-out na criação do tenant).
 */
export interface SeedClausesResult {
  created: number;
  skipped: number;
  embedTargets: EmbedTarget[];
}

type NormalizedClause = {
  title: string;
  content: string;
  tags: string[];
  agentNotes: string;
  subcategory: string;
  isVariable: boolean;
  groupCode: string | null;
  source: string;
};

export async function seedDefaultClauses(opts: {
  orgId: string;
  createdBy: string;
  /** Força os bancos (ignora os módulos). Default: decide pelos módulos. */
  banks?: Array<"vendas" | "locacao">;
}): Promise<SeedClausesResult> {
  const { orgId, createdBy } = opts;

  let banks = opts.banks;
  if (!banks) {
    const view = await getOrgModules(orgId);
    banks = [];
    if (isModuleEnabled(view, MODULE.VENDAS)) banks.push("vendas");
    if (isModuleEnabled(view, MODULE.LOCACAO)) banks.push("locacao");
    // Org sem nenhum módulo (estado transitório na criação): semeia vendas
    // como base — o tenant típico é de vendas e o banco não atrapalha locação.
    if (banks.length === 0) banks.push("vendas");
  }

  const normalized: NormalizedClause[] = [];
  if (banks.includes("vendas")) {
    for (const c of VENDAS_SEED_CLAUSES) {
      normalized.push({
        title: c.title,
        content: c.content,
        tags: c.tags,
        agentNotes: c.agentNotes,
        subcategory: c.subcategory,
        isVariable: c.isVariable,
        groupCode: c.groupCode,
        source: VENDAS_SEED_SOURCE,
      });
    }
  }
  if (banks.includes("locacao")) {
    for (const c of LOCACAO_SEED_CLAUSES) {
      normalized.push({
        title: c.title,
        content: c.content,
        tags: ["locacao", ...c.tags.filter((t) => t !== "locacao")],
        agentNotes: c.agentNotes,
        subcategory: c.subcategory,
        isVariable: c.isVariable,
        groupCode: null, // locação usa tags/subcategory, não G1..G6
        source: LOCACAO_SEED_SOURCE,
      });
    }
  }

  // Idempotência por título dentro da categoria "clause".
  const existing = await prisma.knowledgeItem.findMany({
    where: {
      orgId,
      category: "clause",
      title: { in: normalized.map((c) => c.title) },
    },
    select: { title: true },
  });
  const existingTitles = new Set(existing.map((e) => e.title));
  const toCreate = normalized.filter((c) => !existingTitles.has(c.title));

  const embedTargets: EmbedTarget[] = [];
  for (const c of toCreate) {
    const { embedTargets: t } = await createKnowledgeItemRows({
      orgId,
      category: "clause",
      title: c.title,
      content: c.content,
      tags: c.tags,
      source: c.source,
      createdBy,
      agentNotes: c.agentNotes,
      subcategory: c.subcategory,
      isVariable: c.isVariable,
      groupCode: c.groupCode,
      status: "approved",
    });
    embedTargets.push(...t);
  }

  return {
    created: toCreate.length,
    skipped: normalized.length - toCreate.length,
    embedTargets,
  };
}

/** Espelha `seedDefaultClauses` e dispara o embedding em background (waitUntil
 *  do caller). Conveniência pra call-sites que só querem "semeie". */
export async function seedAndEmbedDefaultClauses(opts: {
  orgId: string;
  createdBy: string;
  banks?: Array<"vendas" | "locacao">;
}): Promise<{ created: number; skipped: number; embed: Promise<void> | null }> {
  const res = await seedDefaultClauses(opts);
  const embed =
    res.embedTargets.length > 0
      ? embedKnowledgeItem(res.embedTargets, {
          orgId: opts.orgId,
          userId: opts.createdBy,
        })
      : null;
  return { created: res.created, skipped: res.skipped, embed };
}
