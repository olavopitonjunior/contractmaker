/**
 * Escrita de AgentProfile. Ponto único porque toda escrita precisa invalidar
 * o cache de resolução — sem isso o admin salva e espera até 60s pra ver
 * efeito, o que parece bug e leva a salvar de novo.
 */

import { prisma } from "@/lib/db/prisma";
import { invalidateAgentProfileCache } from "./resolve";
import { AGENT_REGISTRY, type AgentKey } from "./registry";
import { resolveModel } from "../shared/models";

export interface AgentProfilePatch {
  enabled?: boolean;
  model?: string | null;
  fallbackModel?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  instructions?: string | null;
  ragScope?: unknown;
  monthlyBudgetUsd?: number | null;
  config?: unknown;
}

/**
 * Modelos que o console aceita. Allowlist server-side é obrigatória: um ID
 * inválido (ou um modelo novo demais, que rejeita `temperature` com 400)
 * quebraria o chat em produção só por alguém ter digitado errado.
 */
export const ALLOWED_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
] as const;

export function isAllowedModel(m: string | null | undefined): boolean {
  if (!m) return true; // null = herda, sempre válido
  return (ALLOWED_MODELS as readonly string[]).includes(resolveModel(m));
}

export async function upsertAgentProfile(args: {
  orgId: string | null;
  agentKey: AgentKey;
  patch: AgentProfilePatch;
  updatedBy?: string | null;
}) {
  const { orgId, agentKey, patch, updatedBy } = args;

  // `findFirst` + create/update em vez de `upsert`: o upsert do Prisma precisa
  // de um where único, e `orgId_agentKey` não casa com orgId NULL (dois NULLs
  // são distintos no Postgres). A unicidade das linhas de plataforma é
  // garantida pelo índice parcial da migration.
  const existing = await prisma.agentProfile.findFirst({
    where: { orgId, agentKey },
    select: { id: true },
  });

  const data = {
    ...patch,
    ragScope: patch.ragScope === undefined ? undefined : (patch.ragScope as never),
    config: patch.config === undefined ? undefined : (patch.config as never),
    updatedBy: updatedBy ?? undefined,
  };

  const row = existing
    ? await prisma.agentProfile.update({ where: { id: existing.id }, data })
    : await prisma.agentProfile.create({
        data: { orgId, agentKey, ...data },
      });

  invalidateAgentProfileCache(orgId, agentKey);
  return row;
}

/** Linhas cruas de um escopo, indexadas por agentKey (pra montar a UI). */
export async function listAgentProfiles(orgId: string | null) {
  const rows = await prisma.agentProfile.findMany({
    where: { orgId },
    orderBy: { agentKey: "asc" },
  });
  return new Map(rows.map((r) => [r.agentKey, r]));
}

export function agentLabel(agentKey: string): string {
  return AGENT_REGISTRY[agentKey as AgentKey]?.label ?? agentKey;
}
