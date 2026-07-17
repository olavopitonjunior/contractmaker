import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import {
  HAIKU_MODEL,
  SONNET_MODEL,
  OPUS_MODEL,
  resolveModel,
} from "@/lib/ai/shared/models";
import {
  ANALYST_SYSTEM_PROMPT,
  LEGAL_SYSTEM_PROMPT,
  EDITOR_SYSTEM_PROMPT,
  CURATOR_SYSTEM_PROMPT,
} from "@/lib/ai/specialists/prompts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/PUT /api/admin/agent-defaults — singleton PlatformAgentDefaults.
 * Espelha /api/admin/support/config: leitura pra support, edição só
 * super_admin. Modelo passa por allowlist server-side (mesma dos tenants:
 * família 4.6 + Haiku — teto por causa do temperature).
 */

const ALLOWED_MODELS = new Set([HAIKU_MODEL, SONNET_MODEL, OPUS_MODEL]);

export async function GET() {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  const row = await prisma.platformAgentDefaults.findFirst();
  return NextResponse.json({
    overrides: row ?? null,
    // Prompts hardcoded (variante VENDA) pro admin ver o baseline que o
    // override substitui. A variante de locação vive em prompts-locacao.ts.
    defaults: {
      analystPrompt: ANALYST_SYSTEM_PROMPT,
      legalPrompt: LEGAL_SYSTEM_PROMPT,
      editorPrompt: EDITOR_SYSTEM_PROMPT,
      curatorPrompt: CURATOR_SYSTEM_PROMPT,
      analystModel: HAIKU_MODEL,
      legalModel: HAIKU_MODEL,
      editorModel: SONNET_MODEL,
      curatorModel: HAIKU_MODEL,
    },
  });
}

// null/"" = limpar override (volta pro hardcoded).
const promptField = z.string().max(30000).nullable().optional();
const modelField = z.string().max(100).nullable().optional();

const putSchema = z.object({
  analystPrompt: promptField,
  legalPrompt: promptField,
  editorPrompt: promptField,
  curatorPrompt: promptField,
  analystModel: modelField,
  legalModel: modelField,
  editorModel: modelField,
  curatorModel: modelField,
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // Allowlist de modelo: resolveModel migra aposentados, mas NÃO barra id
  // desconhecido — o Set barra (mesmo padrão do settings/agent do tenant).
  const data: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(parsed.data)) {
    if (raw === undefined) continue;
    const trimmed = typeof raw === "string" ? raw.trim() : raw;
    if (key.endsWith("Model") && trimmed) {
      const resolved = resolveModel(trimmed);
      if (!ALLOWED_MODELS.has(resolved)) {
        return NextResponse.json(
          { error: `Modelo não permitido: ${trimmed}` },
          { status: 400 }
        );
      }
      data[key] = resolved;
    } else {
      data[key] = trimmed || null;
    }
  }

  await prisma.platformAgentDefaults.upsert({
    where: { singletonKey: "singleton" },
    create: { singletonKey: "singleton", ...data, updatedBy: session!.user!.id },
    update: { ...data, updatedBy: session!.user!.id },
  });

  return NextResponse.json({ ok: true });
}
