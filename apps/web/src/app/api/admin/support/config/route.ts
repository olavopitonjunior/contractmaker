import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import {
  getSupportConfig,
  SUPPORT_DEFAULT_SYSTEM_PROMPT,
  SUPPORT_DEFAULT_MODEL,
} from "@/lib/support/config";
import { SUPPORT_CONFIG_SINGLETON } from "@/lib/support/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Leitura da config: support pode ver; edição: super_admin.
export async function GET() {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  const config = await getSupportConfig();
  return NextResponse.json({
    config,
    defaults: { model: SUPPORT_DEFAULT_MODEL, systemPrompt: SUPPORT_DEFAULT_SYSTEM_PROMPT },
  });
}

const putSchema = z.object({
  model: z.string().min(1).max(100),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().int().min(256).max(8192),
  systemPrompt: z.string().max(20000),
  handoffMinSimilarity: z.number().min(0).max(1),
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

  await prisma.supportAgentConfig.upsert({
    where: { singletonKey: SUPPORT_CONFIG_SINGLETON },
    create: { singletonKey: SUPPORT_CONFIG_SINGLETON, ...parsed.data, updatedBy: session!.user!.id },
    update: { ...parsed.data, updatedBy: session!.user!.id },
  });

  return NextResponse.json({ ok: true });
}
