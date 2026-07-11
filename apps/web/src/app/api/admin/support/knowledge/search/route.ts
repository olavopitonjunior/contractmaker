import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { searchSupportKnowledge } from "@/lib/support/knowledge";
import { SUPPORT_MODULE_TAGS } from "@/lib/support/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ query: z.string().min(1).max(500) });

// "Testar RAG" — busca contra a base de suporte com TODAS as tags de módulo
// (o admin quer ver tudo, não filtrado por tenant).
export async function POST(req: NextRequest) {
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

  const res = await searchSupportKnowledge(parsed.data.query, {
    topK: 8,
    moduleTags: [...SUPPORT_MODULE_TAGS],
  });
  return NextResponse.json(res);
}
