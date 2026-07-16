import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  resolveModel,
  SONNET_MODEL,
  HAIKU_MODEL,
  OPUS_MODEL,
} from "@/lib/ai/shared/models";
import { requireOrgAdmin } from "@/lib/security/org-scope";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

// Allowlist server-side de modelos. O PUT aceitava qualquer string (passava por
// resolveModel, que deixa IDs desconhecidos passarem) — um cliente de API podia
// setar um modelo caro/arbitrário no agente jurídico da org. A UI só oferece
// estes; o servidor agora impõe o mesmo conjunto.
const ALLOWED_MODELS = new Set([HAIKU_MODEL, SONNET_MODEL, OPUS_MODEL]);

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

const putSchema = z.object({
  model: z.string().optional(),
  ocrModel: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(256).max(8192).optional(),
  systemPrompt: z.string().max(20_000).optional(),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Só owner/admin da org edita o agente jurídico — antes qualquer member
  // trocava modelo/temperatura/system prompt, sem auditoria.
  const gate = await requireOrgAdmin(session.user.id);
  if (!gate.ok) return gate.res;
  const orgId = gate.orgId;

  const raw = await req.json().catch(() => ({}));
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const model = resolveModel(body.model, SONNET_MODEL);
  const ocrModel = resolveModel(body.ocrModel, HAIKU_MODEL);
  if (!ALLOWED_MODELS.has(model) || !ALLOWED_MODELS.has(ocrModel)) {
    return NextResponse.json(
      { error: "Modelo não permitido. Use um dos modelos oferecidos." },
      { status: 400 }
    );
  }

  const config = await prisma.agentConfig.upsert({
    where: { orgId },
    update: {
      model,
      ocrModel,
      temperature: body.temperature ?? 0.3,
      maxTokens: body.maxTokens ?? 4096,
      systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
    create: {
      orgId,
      model,
      ocrModel,
      temperature: body.temperature ?? 0.3,
      maxTokens: body.maxTokens ?? 4096,
      systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
  });

  await audit(
    extractAuditContextFromRequest(req, orgId, session.user.id),
    {
      action: "AGENT_CONFIG_UPDATE",
      result: "SUCCESS",
      resourceType: "AgentConfig",
      resource: `org:${orgId}`,
      metadata: {
        model,
        ocrModel,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        systemPromptChanged: Boolean(body.systemPrompt),
      },
    }
  ).catch(() => {});

  return NextResponse.json(config);
}
