import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import {
  createKnowledgeItemRows,
  embedKnowledgeItem,
  type EmbedTarget,
} from "@/lib/ai/knowledge";
import {
  CLAUSE_SLOT_KEYS,
  CLAUSE_SLOTS,
  slotTagsFor,
  type ClauseSlotKey,
} from "@/lib/templates/clause-slots";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  slot: z.enum(CLAUSE_SLOT_KEYS),
  /** Nome do lote consolidado — vira prefixo do título de cada cláusula. */
  sourceName: z.string().trim().min(1).max(200),
  variants: z
    .array(
      z.object({
        /** Opção do formulário (ex.: `fiador`) — vira a tag `garantia:fiador`. */
        value: z.string().trim().min(1).max(60),
        title: z.string().trim().max(200).optional(),
        content: z.string().trim().min(20).max(20_000),
      })
    )
    .min(1)
    .max(20),
});

/**
 * POST /api/templates/ingest/clauses
 *
 * Fecha a CONSOLIDAÇÃO: os blocos que divergiam entre N modelos quase idênticos
 * viram cláusulas do acervo, cada uma amarrada à opção do formulário por tag
 * (`slot:garantia` + `garantia:fiador`). Na geração, `resolveClauseSlots` casa a
 * escolha do form com a tag e injeta a cláusula no `{{{slot_garantia}}}` do
 * template consolidado.
 *
 * Idempotente por reingestão: cláusulas anteriores do MESMO par de tags são
 * ARQUIVADAS (não apagadas) antes de gravar as novas — refazer a consolidação
 * do mesmo lote corrige o acervo em vez de duplicá-lo, e nada se perde.
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
      { error: "Apenas owner/admin podem criar cláusulas." },
      { status: 403 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { slot, sourceName, variants } = parsed.data as {
    slot: ClauseSlotKey;
    sourceName: string;
    variants: Array<{ value: string; title?: string; content: string }>;
  };

  const def = CLAUSE_SLOTS[slot];

  // Uma opção do form = uma cláusula. Duas variantes rotuladas igual seriam
  // ambíguas na geração (a resolução pega a mais recente e a outra vira lixo).
  const seen = new Set<string>();
  for (const v of variants) {
    if (seen.has(v.value)) {
      return NextResponse.json(
        {
          error: `Duas variantes foram marcadas como "${def.valueLabel(v.value)}". Cada opção do formulário pode ter só uma cláusula.`,
        },
        { status: 422 }
      );
    }
    seen.add(v.value);
  }

  let created: Array<{ id: string; title: string; value: string; tags: string[] }>;
  let embedTargets: EmbedTarget[];
  try {
    ({ created, embedTargets } = await prisma.$transaction(
      async (tx) => {
        const rows: Array<{ id: string; title: string; value: string; tags: string[] }> =
          [];
        const targets: EmbedTarget[] = [];
        for (const variant of variants) {
          const tags = slotTagsFor(slot, variant.value);
          // Arquiva a geração anterior deste par de tags (mesma org).
          await tx.knowledgeItem.updateMany({
            where: {
              orgId: org.id,
              category: "clause",
              status: "approved",
              tags: { hasEvery: tags },
            },
            data: { status: "archived" },
          });

          const title = (
            variant.title?.trim() ||
            `${sourceName} — ${def.label} (${def.valueLabel(variant.value)})`
          ).slice(0, 300);

          const row = await createKnowledgeItemRows(
            {
              orgId: org.id,
              category: "clause",
              title,
              content: variant.content,
              tags,
              source: "consolidacao_modelos",
              createdBy: effUserId,
            },
            tx
          );
          rows.push({ id: row.parentId, title, value: variant.value, tags });
          targets.push(...row.embedTargets);
        }
        return { created: rows, embedTargets: targets };
      },
      { timeout: 30_000, maxWait: 10_000 }
    ));
  } catch (err) {
    console.error("[templates/ingest/clauses] gravação falhou:", err);
    return NextResponse.json(
      { error: "Falha ao gravar as cláusulas — nada foi salvo. Tente novamente." },
      { status: 500 }
    );
  }

  // Um lote de embedding pros N itens; fora da transação (Voyage é externo).
  waitUntil(embedKnowledgeItem(embedTargets, { orgId: org.id, userId: effUserId }));

  return NextResponse.json({ slot, items: created }, { status: 201 });
}
