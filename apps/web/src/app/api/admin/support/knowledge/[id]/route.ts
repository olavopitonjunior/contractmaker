import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { updateKnowledgeItem, deleteKnowledgeItem } from "@/lib/ai/knowledge";
import { VoyageError } from "@/lib/ai/embeddings";
import { SUPPORT_MODULE_TAGS } from "@/lib/support/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().min(3).max(300).optional(),
  content: z.string().min(3).max(50000).optional(),
  tags: z.array(z.enum(SUPPORT_MODULE_TAGS)).min(1).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }

  // Base de suporte = escopo de PLATAFORMA (orgId nulo).

  const orgId = null;
  try {
    await updateKnowledgeItem(params.id, orgId, { ...parsed.data, allowPlatformScope: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof VoyageError) {
      return NextResponse.json({ error: "Falha ao reembedar", detail: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro" },
      { status: 404 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  // Base de suporte = escopo de PLATAFORMA (orgId nulo).

  const orgId = null;
  await deleteKnowledgeItem(params.id, orgId, { allowPlatformScope: true });
  return NextResponse.json({ ok: true });
}
