import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { emitNotification } from "@/lib/notifications/emit";
import { SUPPORT_CATEGORY, SUPPORT_MODULE_TAGS } from "@/lib/support/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  answer: z.string().min(3).max(20000),
  tag: z.enum(SUPPORT_MODULE_TAGS).default("geral"),
});

// Responde uma pendência: (1) vira item da base (retroalimentação),
// (2) marca answered, (3) notifica o usuário que perguntou.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }

  const handoff = await prisma.supportHandoff.findUnique({ where: { id: params.id } });
  if (!handoff) {
    return NextResponse.json({ error: "Pendência não encontrada" }, { status: 404 });
  }
  if (handoff.status === "answered") {
    return NextResponse.json({ error: "Já respondida" }, { status: 409 });
  }

  // (1) Retroalimenta a base de suporte — escopo de PLATAFORMA (orgId nulo).
  const { parentId } = await createKnowledgeItem({
    orgId: null,
    allowPlatformScope: true,
    visibleToAgents: ["support"],
    category: SUPPORT_CATEGORY,
    title: handoff.question.slice(0, 200),
    content: `${handoff.question}\n\n${parsed.data.answer}`,
    tags: [parsed.data.tag],
    source: `handoff:${handoff.id}`,
    createdBy: session!.user!.id,
  });

  // (2) Marca a pendência como respondida.
  await prisma.supportHandoff.update({
    where: { id: handoff.id },
    data: {
      status: "answered",
      answer: parsed.data.answer,
      answeredBy: session!.user!.id,
      answeredAt: new Date(),
      knowledgeItemId: parentId,
    },
  });

  // (3) Notifica quem perguntou (bell in-app). Só se temos org+user do autor.
  if (handoff.orgId && handoff.userId) {
    await emitNotification({
      orgId: handoff.orgId,
      userId: handoff.userId,
      type: "support_answered",
      title: "Sua dúvida foi respondida",
      body: parsed.data.answer,
      linkUrl: handoff.screenPath ?? "/",
      metadata: { handoffId: handoff.id },
    });
  }

  return NextResponse.json({ ok: true, knowledgeItemId: parentId });
}
