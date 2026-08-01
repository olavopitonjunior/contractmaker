/**
 * Escrita de AgentProfile. Ponto único porque toda escrita precisa invalidar
 * o cache de resolução — sem isso o admin salva e espera até 60s pra ver
 * efeito, o que parece bug e leva a salvar de novo.
 */

import { z } from "zod";
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

/**
 * Categorias que o escopo de RAG pode nomear.
 *
 * `support` fica de fora de propósito: `knowledge-scope.ts` exclui essa
 * categoria do RAG jurídico de qualquer jeito, então aceitá-la aqui deixaria o
 * admin montar um escopo que sempre volta vazio — configuração que parece
 * válida e não faz nada é pior que erro de validação.
 */
export const RAG_SCOPE_CATEGORIES = [
  "legislation",
  "model",
  "rule",
  "glossary",
  "clause",
] as const;

/**
 * Escopo de RAG gravável pelo console e pela tela do tenant.
 *
 * Os três campos são opcionais e ausência significa "sem restrição" —
 * `includePlatform` só corta a base universal quando é explicitamente `false`
 * (ver `knowledge-scope.ts`). `null` no objeto inteiro apaga o escopo e volta
 * ao herdado.
 */
export const ragScopeSchema = z
  .object({
    categories: z.array(z.enum(RAG_SCOPE_CATEGORIES)).max(RAG_SCOPE_CATEGORIES.length).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    includePlatform: z.boolean().optional(),
  })
  .strict()
  .nullable();

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

  let row;
  if (existing) {
    row = await prisma.agentProfile.update({ where: { id: existing.id }, data });
  } else {
    try {
      row = await prisma.agentProfile.create({ data: { orgId, agentKey, ...data } });
    } catch (err) {
      // Corrida entre o findFirst e o create (dois admins salvando o mesmo
      // agente): o unique — composto, ou o parcial das linhas de plataforma —
      // rejeita o segundo. Reler e atualizar é o resultado que o usuário
      // esperava; deixar vazar viraria 500 sem explicação na tela.
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "P2002"
      ) {
        const raced = await prisma.agentProfile.findFirst({
          where: { orgId, agentKey },
          select: { id: true },
        });
        if (!raced) throw err;
        row = await prisma.agentProfile.update({ where: { id: raced.id }, data });
      } else {
        throw err;
      }
    }
  }

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
