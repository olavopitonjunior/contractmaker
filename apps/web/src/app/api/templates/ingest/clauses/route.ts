import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { embedKnowledgeItem } from "@/lib/ai/knowledge";
import { CLAUSE_SLOT_KEYS, type ClauseSlotKey } from "@/lib/templates/clause-slots";
import {
  ClauseIngestValidationError,
  ingestSlotClauses,
  type IngestClauseVariant,
} from "@/lib/templates/ingest-clauses";

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
        /**
         * Garantidor da redação, no rótulo humano do catálogo da org ("Porto
         * Seguro") — vira a tag `provider:porto_seguro`. Ausente = cláusula
         * genérica do tipo.
         */
        provider: z.string().trim().max(120).optional(),
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
 * Casca fina: autentica, valida o payload e delega pra `ingestSlotClauses`
 * (lib/templates/ingest-clauses.ts), que é onde vive a semântica — incluindo a
 * idempotência por conjunto EXATO de tags. O executor da ingestão em lote chama
 * a mesma função direto, sem HTTP self-call.
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
    variants: IngestClauseVariant[];
  };

  try {
    const { items, embedTargets } = await ingestSlotClauses({
      orgId: org.id,
      slot,
      sourceName,
      variants,
      createdBy: effUserId,
    });
    // Um lote de embedding pros N itens; fora da transação (Voyage é externo).
    waitUntil(embedKnowledgeItem(embedTargets, { orgId: org.id, userId: effUserId }));
    return NextResponse.json({ slot, items }, { status: 201 });
  } catch (err) {
    if (err instanceof ClauseIngestValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[templates/ingest/clauses] gravação falhou:", err);
    return NextResponse.json(
      { error: "Falha ao gravar as cláusulas — nada foi salvo. Tente novamente." },
      { status: 500 }
    );
  }
}
