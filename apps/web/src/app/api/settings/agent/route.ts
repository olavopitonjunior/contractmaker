import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/prompts";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const config = await prisma.agentConfig.findUnique({
    where: { orgId: org.id },
  });

  return NextResponse.json(
    config || {
      model: "claude-sonnet-4-20250514",
      ocrModel: "claude-haiku-4-5-20251001",
      temperature: 0.3,
      maxTokens: 4096,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    }
  );
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json();

  const config = await prisma.agentConfig.upsert({
    where: { orgId: org.id },
    update: {
      model: body.model || "claude-sonnet-4-20250514",
      ocrModel: body.ocrModel || "claude-haiku-4-5-20251001",
      temperature: body.temperature ?? 0.3,
      maxTokens: body.maxTokens ?? 4096,
      systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
    create: {
      orgId: org.id,
      model: body.model || "claude-sonnet-4-20250514",
      ocrModel: body.ocrModel || "claude-haiku-4-5-20251001",
      temperature: body.temperature ?? 0.3,
      maxTokens: body.maxTokens ?? 4096,
      systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
  });

  return NextResponse.json(config);
}
