import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { prisma } from "@/lib/db/prisma";
import { isAgentKey, type AgentKey } from "@/lib/ai/agents/registry";
import { upsertAgentProfile, isAllowedModel, ragScopeSchema } from "@/lib/ai/agents/store";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/agents/[agentKey]/versions/[versionId]/restore
 *
 * Restaurar = NOVA escrita com o snapshot antigo — nunca rewind. Passa pelo
 * `upsertAgentProfile` normal, então: gera uma versão nova no histórico
 * (restauração é evento, não apagamento), invalida o cache de resolução
 * (pega em ≤1 min) e aparece no audit com `restoredFromVersionId`.
 *
 * O snapshot é REVALIDADO antes de aplicar: um modelo que era permitido na
 * época pode ter sido aposentado — restaurar cegamente re-quebraria o chat
 * com um 404 da API, que é exatamente o incidente que a procedência expôs.
 */
const snapshotSchema = z.object({
  enabled: z.boolean().nullish(),
  model: z.string().nullish(),
  fallbackModel: z.string().nullish(),
  temperature: z.number().min(0).max(1).nullish(),
  maxTokens: z.number().int().min(256).max(8192).nullish(),
  instructions: z.string().max(20_000).nullish(),
  ragScope: ragScopeSchema.nullish(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).nullish(),
  config: z.record(z.unknown()).nullish(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { agentKey: string; versionId: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  if (!isAgentKey(params.agentKey)) {
    return NextResponse.json({ error: "Agente desconhecido" }, { status: 404 });
  }
  const agentKey = params.agentKey as AgentKey;

  const version = await prisma.agentProfileVersion.findUnique({
    where: { id: params.versionId },
  });
  // A versão pertence a UM (orgId, agentKey) — restaurar a versão de um
  // agente/escopo por outro seria corrupção silenciosa de config.
  if (!version || version.agentKey !== agentKey) {
    return NextResponse.json({ error: "Versão não encontrada" }, { status: 404 });
  }

  const parsed = snapshotSchema.safeParse(version.snapshot);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Snapshot ilegível — versão de um formato antigo?" },
      { status: 422 }
    );
  }
  const snap = parsed.data;

  if (!isAllowedModel(snap.model ?? null) || !isAllowedModel(snap.fallbackModel ?? null)) {
    return NextResponse.json(
      {
        error:
          "Esta versão usa um modelo que não é mais permitido — restaure os demais campos manualmente.",
      },
      { status: 409 }
    );
  }

  await upsertAgentProfile({
    orgId: version.orgId,
    agentKey,
    patch: {
      enabled: snap.enabled ?? undefined,
      model: snap.model ?? null,
      fallbackModel: snap.fallbackModel ?? null,
      temperature: snap.temperature ?? null,
      maxTokens: snap.maxTokens ?? null,
      instructions: snap.instructions ?? null,
      ragScope: snap.ragScope ?? null,
      monthlyBudgetUsd: snap.monthlyBudgetUsd ?? null,
      config: snap.config ?? null,
    },
    updatedBy: session!.user!.id,
  });

  await audit(
    {
      ...extractAuditContextFromRequest(req, version.orgId ?? "", session!.user!.id),
      orgId: version.orgId ?? null,
    },
    {
      action: "AGENT_CONFIG_UPDATE",
      result: "SUCCESS",
      resourceType: "AgentProfile",
      resource: `${version.orgId ?? "platform"}:${agentKey}`,
      metadata: { restoredFromVersionId: version.id },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
