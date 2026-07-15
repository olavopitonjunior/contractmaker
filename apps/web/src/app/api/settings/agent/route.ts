import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { resolveModel, SONNET_MODEL, HAIKU_MODEL } from "@/lib/ai/shared/models";

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

  if (!config) {
    return NextResponse.json({
      model: SONNET_MODEL,
      ocrModel: HAIKU_MODEL,
      temperature: 0.3,
      maxTokens: 4096,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    });
  }

  // Normaliza IDs aposentados gravados antes da migração — o select da UI só
  // conhece os IDs atuais e o runtime já resolve via resolveModel.
  return NextResponse.json({
    ...config,
    model: resolveModel(config.model, SONNET_MODEL),
    ocrModel: resolveModel(config.ocrModel, HAIKU_MODEL),
  });
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
  const model = resolveModel(body.model, SONNET_MODEL);
  const ocrModel = resolveModel(body.ocrModel, HAIKU_MODEL);

  const config = await prisma.agentConfig.upsert({
    where: { orgId: org.id },
    update: {
      model,
      ocrModel,
      temperature: body.temperature ?? 0.3,
      maxTokens: body.maxTokens ?? 4096,
      systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
    create: {
      orgId: org.id,
      model,
      ocrModel,
      temperature: body.temperature ?? 0.3,
      maxTokens: body.maxTokens ?? 4096,
      systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
  });

  return NextResponse.json(config);
}
