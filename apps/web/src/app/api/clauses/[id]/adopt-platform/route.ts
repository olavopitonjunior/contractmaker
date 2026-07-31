/**
 * Adota o texto de uma cláusula de slot da PLATAFORMA na cláusula da org.
 *
 * A geração nunca faz isso sozinha (ver `resolveClauseSlots`): cláusula de slot
 * vira texto de contrato e congela no `dataJson`, então substituir o que a
 * imobiliária escreveu é decisão dela, tomada aqui, com o diff na frente.
 *
 * É uma escrita ORG-SCOPED: sobrescreve a cláusula da própria org com o
 * conteúdo da universal. A cláusula de plataforma não é tocada.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { resolveUserOrgId } from "@/lib/security/org-scope";
import { updateKnowledgeItem, KnowledgeItemNotFoundError } from "@/lib/ai/knowledge";
import { slotSelectionKey } from "@/lib/knowledge/platform-slot-updates";
import { VoyageError } from "@/lib/ai/embeddings";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ platformClauseId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = await resolveUserOrgId(session.user.id);
  if (!orgId) {
    return NextResponse.json({ error: "Sem organização" }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "platformClauseId obrigatório" }, { status: 400 });
  }

  const [daOrg, daPlataforma] = await Promise.all([
    prisma.knowledgeItem.findFirst({
      where: { id: params.id, orgId, category: "clause" },
      select: { id: true, tags: true, title: true },
    }),
    prisma.knowledgeItem.findFirst({
      // `orgId: null` é o que impede adotar a cláusula de OUTRO tenant passando
      // o id dele aqui — a origem tem que ser a base universal.
      where: { id: parsed.data.platformClauseId, orgId: null, category: "clause" },
      select: { id: true, tags: true, content: true, title: true },
    }),
  ]);

  if (!daOrg || !daPlataforma) {
    return NextResponse.json({ error: "Cláusula não encontrada" }, { status: 404 });
  }

  // As duas têm que servir ao MESMO slot/opção/garantidor. Sem esta checagem, um
  // POST direto trocaria a cláusula de caução pela de fiador — e o contrato
  // seguinte sairia com a garantia errada.
  const chaveOrg = slotSelectionKey(daOrg.tags);
  const chavePlataforma = slotSelectionKey(daPlataforma.tags);
  if (!chaveOrg || chaveOrg !== chavePlataforma) {
    return NextResponse.json(
      { error: "As cláusulas não atendem à mesma opção de slot." },
      { status: 409 }
    );
  }

  try {
    // Passa pelo helper de propósito: é ele que refaz os chunks e o embedding
    // quando o conteúdo muda (senão a busca seguiria achando o texto antigo).
    await updateKnowledgeItem(params.id, orgId, { content: daPlataforma.content });
  } catch (err) {
    if (err instanceof KnowledgeItemNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof VoyageError) {
      return NextResponse.json(
        { error: "Texto adotado, mas o reembedding falhou", detail: err.message },
        { status: 502 }
      );
    }
    throw err;
  }

  await audit(extractAuditContextFromRequest(req, orgId, session.user.id), {
    action: "CLAUSE_ADOPT_PLATFORM",
    result: "SUCCESS",
    resourceType: "KnowledgeItem",
    resource: params.id,
    metadata: {
      platformClauseId: daPlataforma.id,
      platformTitle: daPlataforma.title,
      slot: chaveOrg,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
