import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import {
  createKnowledgeItemRows,
  embedKnowledgeItem,
  type EmbedTarget,
} from "@/lib/ai/knowledge";
import {
  LOCACAO_SEED_CLAUSES,
  LOCACAO_SEED_SOURCE,
} from "@/lib/knowledge/seed-clauses-locacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/knowledge/seed-defaults
 *
 * Botão "Usar cláusulas padrão (Lei 8.245/91)" do onboarding: semeia o conjunto
 * curado de cláusulas de locação. Idempotente por (orgId, category:"clause",
 * title) — reexecutar só cria as que faltam. Embedding em background (waitUntil).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem semear cláusulas." },
      { status: 403 }
    );
  }

  // Idempotência por título dentro da categoria "clause".
  const existing = await prisma.knowledgeItem.findMany({
    where: {
      orgId: org.id,
      category: "clause",
      title: { in: LOCACAO_SEED_CLAUSES.map((c) => c.title) },
    },
    select: { title: true },
  });
  const existingTitles = new Set(existing.map((e) => e.title));
  const toCreate = LOCACAO_SEED_CLAUSES.filter((c) => !existingTitles.has(c.title));

  const targets: EmbedTarget[] = [];
  for (const c of toCreate) {
    const { embedTargets } = await createKnowledgeItemRows({
      orgId: org.id,
      category: "clause",
      title: c.title,
      content: c.content,
      tags: ["locacao", ...c.tags.filter((t) => t !== "locacao")],
      source: LOCACAO_SEED_SOURCE,
      createdBy: effUserId,
      agentNotes: c.agentNotes,
      subcategory: c.subcategory,
      isVariable: c.isVariable,
      status: "approved",
    });
    targets.push(...embedTargets);
  }

  // Embedding best-effort em background — responde já, não segura no Voyage.
  if (targets.length > 0) {
    waitUntil(embedKnowledgeItem(targets, { orgId: org.id, userId: effUserId }));
  }

  return NextResponse.json({
    created: toCreate.length,
    skipped: existingTitles.size,
  });
}
