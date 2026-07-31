/**
 * Edição/remoção de item da base de PLATAFORMA. Só `super_admin` — ver a nota
 * de escopo em ../route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { updateKnowledgeItem, deleteKnowledgeItem } from "@/lib/ai/knowledge";
import { VoyageError } from "@/lib/ai/embeddings";
import { AGENT_KEYS } from "@/lib/ai/agents/registry";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.string().min(1).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  source: z.string().max(300).optional(),
  visibleToAgents: z.array(z.enum(AGENT_KEYS)).max(AGENT_KEYS.length).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { visibleToAgents, ...patch } = parsed.data;

  try {
    // `orgId: null` faz o findFirst interno casar SÓ com linha de plataforma —
    // um id de tenant passado aqui dá 404, não escrita cross-escopo.
    await updateKnowledgeItem(params.id, null, {
      ...patch,
      allowPlatformScope: true,
    });
  } catch (err) {
    if (err instanceof VoyageError) {
      return NextResponse.json(
        { error: "Falha ao reembedar", detail: err.message },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro" },
      { status: 404 }
    );
  }

  if (visibleToAgents) {
    await prisma.knowledgeItem.updateMany({
      where: { orgId: null, OR: [{ id: params.id }, { parentId: params.id }] },
      data: { visibleToAgents },
    });
  }

  await audit(
    { ...extractAuditContextFromRequest(req, "", session!.user!.id), orgId: null },
    {
      action: "PLATFORM_KNOWLEDGE_UPDATE",
      result: "SUCCESS",
      resourceType: "KnowledgeItem",
      resource: params.id,
      metadata: { fields: Object.keys(parsed.data) },
    }
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  await deleteKnowledgeItem(params.id, null, { allowPlatformScope: true });

  await audit(
    { ...extractAuditContextFromRequest(req, "", session!.user!.id), orgId: null },
    {
      action: "PLATFORM_KNOWLEDGE_DELETE",
      result: "SUCCESS",
      resourceType: "KnowledgeItem",
      resource: params.id,
    }
  );

  return NextResponse.json({ ok: true });
}
