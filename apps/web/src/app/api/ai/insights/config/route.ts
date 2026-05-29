import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

const contextsSchema = z.object({
  dashboard: z.boolean(),
  contract: z.boolean(),
  property: z.boolean(),
  cashflow: z.boolean(),
});

const configSchema = z.object({
  enabled: z.boolean(),
  contexts: contextsSchema,
});

export type AiInsightsConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: AiInsightsConfig = {
  enabled: true,
  contexts: { dashboard: true, contract: true, property: true, cashflow: true },
};

async function loadConfig(orgId: string): Promise<AiInsightsConfig> {
  const ac = await prisma.agentConfig.findUnique({
    where: { orgId },
    select: { aiInsightsConfig: true },
  });
  const raw = ac?.aiInsightsConfig as unknown;
  const parsed = configSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_CONFIG;
}

/**
 * GET /api/ai/insights/config — config atual (com defaults se nunca salvou).
 * PUT — substitui config inteiro. Owner-only.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json(DEFAULT_CONFIG);
  return NextResponse.json(await loadConfig(org.id));
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "Sem org" }, { status: 404 });

  // Owner-only — config IA tem custo direto.
  const membership = await prisma.orgMembership.findFirst({
    where: { orgId: org.id, userId: session.user.id },
    select: { role: true },
  });
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Apenas owners" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // Garante AgentConfig existe — upsert via update + fallback create.
  const existing = await prisma.agentConfig.findUnique({
    where: { orgId: org.id },
    select: { id: true },
  });
  if (existing) {
    await prisma.agentConfig.update({
      where: { orgId: org.id },
      data: { aiInsightsConfig: parsed.data },
    });
  } else {
    await prisma.agentConfig.create({
      data: {
        orgId: org.id,
        systemPrompt: "",
        aiInsightsConfig: parsed.data,
      },
    });
  }

  await audit(
    { orgId: org.id, userId: session.user.id },
    {
      action: "AI_INSIGHTS_CONFIG_UPDATE",
      result: "SUCCESS",
      resource: "AgentConfig",
      resourceType: "AgentConfig",
      metadata: { enabled: parsed.data.enabled },
    }
  );

  return NextResponse.json(parsed.data);
}
