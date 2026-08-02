/**
 * Console de agentes — visão de PLATAFORMA (super_admin).
 *
 * Substitui /api/admin/agent-defaults, que só cobria os 4 especialistas do
 * orquestrador e não tinha nem fallback, nem budget, nem liga/desliga, nem os
 * outros agentes que também gastam token (passiva, OCR, insights, suporte, Max).
 *
 * Escopo por query param:
 *   sem `orgId`  → linha de plataforma (default de todos os tenants)
 *   com `orgId`  → override daquele tenant
 *
 * Leitura pra `support`, escrita só pra `super_admin` — mesmo padrão da rota
 * que este arquivo aposenta.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { prisma } from "@/lib/db/prisma";
import {
  AGENT_DEFINITIONS,
  AGENT_REGISTRY,
  isAgentKey,
  type AgentKey,
} from "@/lib/ai/agents/registry";
import {
  listAgentProfiles,
  upsertAgentProfile,
  isAllowedModel,
  ALLOWED_MODELS,
  ragScopeSchema,
  RAG_SCOPE_CATEGORIES,
} from "@/lib/ai/agents/store";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  const orgId = req.nextUrl.searchParams.get("orgId");

  if (orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });
    }
  }

  const rows = await listAgentProfiles(orgId);

  // `updatedBy` é gravado em toda escrita desde o primeiro dia do console e
  // nunca tinha sido lido por tela nenhuma. Resolve os nomes num lote só.
  const editorIds = [
    ...new Set(
      [...rows.values()]
        .map((r) => r.updatedBy)
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const editors = editorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: editorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const editorName = new Map(
    editors.map((u) => [u.id, u.name || u.email || u.id])
  );

  const agents = await Promise.all(
    AGENT_DEFINITIONS.map(async (def) => {
      const row = rows.get(def.key);
      // O resolvido mostra o que REALMENTE vai rodar, incluindo o que é
      // herdado — sem isso a tela some com a herança e o admin acha que
      // "vazio" quer dizer "sem modelo".
      const resolved = await resolveAgentProfile(def.key, orgId);
      return {
        agentKey: def.key,
        label: def.label,
        description: def.description,
        external: def.external ?? false,
        tenantEditable: def.tenantEditable,
        supports: def.supports,
        defaultModel: def.defaultModel,
        /** Valores gravados NESTE escopo (null = herda). */
        own: {
          enabled: row?.enabled ?? true,
          model: row?.model ?? null,
          fallbackModel: row?.fallbackModel ?? null,
          temperature: row?.temperature ?? null,
          maxTokens: row?.maxTokens ?? null,
          instructions: row?.instructions ?? "",
          ragScope: (row?.ragScope as unknown) ?? null,
          monthlyBudgetUsd:
            row?.monthlyBudgetUsd === null || row?.monthlyBudgetUsd === undefined
              ? null
              : Number(row.monthlyBudgetUsd),
          updatedAt: row?.updatedAt?.toISOString() ?? null,
          updatedByName: row?.updatedBy
            ? editorName.get(row.updatedBy) ?? row.updatedBy
            : null,
        },
        resolved: {
          model: resolved.model,
          fallbackModel: resolved.fallbackModel,
          enabled: resolved.enabled,
          ragScope: resolved.ragScope,
        },
      };
    })
  );

  return NextResponse.json({
    scope: orgId ? { type: "org", orgId } : { type: "platform" },
    allowedModels: ALLOWED_MODELS,
    ragCategories: RAG_SCOPE_CATEGORIES,
    agents,
  });
}

const patchSchema = z.object({
  // min(1): string vazia não é "plataforma" (isso é `null`) nem org válida —
  // sem isso vira FK violation P2003 e 500 opaco no console.
  orgId: z.string().min(1).nullable().optional(),
  agentKey: z.string().refine(isAgentKey, "Agente desconhecido"),
  enabled: z.boolean().optional(),
  model: z.string().nullable().optional(),
  fallbackModel: z.string().nullable().optional(),
  temperature: z.number().min(0).max(1).nullable().optional(),
  maxTokens: z.number().int().min(256).max(8192).nullable().optional(),
  instructions: z.string().max(20_000).nullable().optional(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).nullable().optional(),
  // Escopo de RAG do agente. Ausente = não mexe; `null` = apaga e volta a herdar.
  ragScope: ragScopeSchema.optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { orgId, agentKey, ...patch } = parsed.data;

  // Mesmo check do GET: org inexistente estouraria a FK como 500 opaco.
  if (orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });
    }
  }

  // Mesmo guard da rota do tenant: `ragScope` só é gravável para agente que o
  // runtime honra. Sem isto o console gravaria restrição que nunca é aplicada,
  // e a próxima pessoa a ler o banco acharia que existe uma em vigor.
  if (
    patch.ragScope !== undefined &&
    !AGENT_REGISTRY[agentKey as AgentKey].supports.ragScope
  ) {
    return NextResponse.json(
      { error: "Este agente não consulta a base de conhecimento." },
      { status: 400 }
    );
  }

  if (!isAllowedModel(patch.model) || !isAllowedModel(patch.fallbackModel)) {
    return NextResponse.json(
      { error: "Modelo não permitido. Use um dos modelos oferecidos." },
      { status: 400 }
    );
  }
  // Fallback igual ao principal não é fallback — em 429 tentaria o mesmo modelo
  // sobrecarregado e só dobraria a espera.
  if (patch.model && patch.fallbackModel && patch.model === patch.fallbackModel) {
    return NextResponse.json(
      { error: "O modelo de fallback precisa ser diferente do principal." },
      { status: 400 }
    );
  }

  await upsertAgentProfile({
    orgId: orgId ?? null,
    agentKey: agentKey as AgentKey,
    patch: {
      ...patch,
      instructions:
        patch.instructions === undefined
          ? undefined
          : patch.instructions?.trim() || null,
    },
    updatedBy: session!.user!.id,
  });

  // A rota do tenant já auditava; escrita de super_admin no escopo de outro
  // tenant merece o mesmo rastro — é justamente a que ninguém da org viu.
  // Contexto montado à mão: `AuditContext.orgId` é nullable (evento de
  // plataforma não pertence a tenant nenhum), mas o helper exige string.
  await audit(
    {
      ...extractAuditContextFromRequest(req, orgId ?? "", session!.user!.id),
      orgId: orgId ?? null,
    },
    {
      action: "AGENT_CONFIG_UPDATE",
      result: "SUCCESS",
      resourceType: "AgentProfile",
      resource: `${orgId ?? "platform"}:${agentKey}`,
      metadata: {
        agentKey,
        scope: orgId ? "org" : "platform",
        ...patch,
        instructions: undefined,
        instructionsLength: patch.instructions?.length ?? null,
      },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
