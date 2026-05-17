/**
 * Memory service unificado — consolida acesso a:
 *   - AuditLog (eventos de policy, signs, ações administrativas)
 *   - AIUsage (consumo por turn, por agent)
 *   - ChatMessage.events (timeline interno de tool_use/results)
 *   - ContractChangeLog (mutações reais no doc)
 *
 * F3 traz `recordEvent` (helper fire-and-forget pra emitir eventos
 * estruturados de auditoria) e `getTimeline` (agregador que devolve
 * cronologia unificada pra UI de audit).
 *
 * F4+ pode estender com `findSimilarTimelines`, `summarizeForUser` etc.
 */

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

export type TimelineEntryKind =
  | "agent_start"
  | "agent_complete"
  | "tool_call"
  | "policy_block"
  | "attachment_quarantine"
  | "edit"
  | "approval"
  | "message";

export interface TimelineEntry {
  /** Identificador único — pode ser auditLogId, aiUsageId, etc. */
  id: string;
  kind: TimelineEntryKind;
  /** Quando ocorreu. */
  at: Date;
  /** Slug do agente envolvido (orchestrator|analyst|legal|editor|curator|sentinel). */
  agent?: string;
  /** Texto curto pra exibir na UI. */
  summary: string;
  /** Payload completo pra debug — JSON-safe. */
  details?: Record<string, unknown>;
}

interface TimelineOptions {
  /** Filtra eventos pra esta session. */
  sessionId?: string;
  /** Limite total de entradas. Default 200. */
  limit?: number;
}

/**
 * Devolve timeline cronológica do contrato (mais recente primeiro).
 * Combina AuditLog (resourceType=contract) + AIUsage + ContractChangeLog.
 *
 * NÃO inclui o histórico do PostgresSaver (esse vive em `/audit` via
 * `graph.getStateHistory` — schema separado). Esta função traz o que está
 * no schema da app.
 */
export async function getTimeline(
  contractId: string,
  options: TimelineOptions = {}
): Promise<TimelineEntry[]> {
  const limit = options.limit ?? 200;

  const [audits, usages, changes] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        resourceType: "contract",
        resource: contractId,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.aIUsage.findMany({
      where: { contractId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.contractChangeLog.findMany({
      where: {
        contractId,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const entries: TimelineEntry[] = [];

  for (const a of audits) {
    let kind: TimelineEntryKind = "message";
    if (a.action === "AGENT_TOOL_BLOCKED") kind = "policy_block";
    else if (a.action === "SENTINEL_ATTACHMENT_QUARANTINED") kind = "attachment_quarantine";
    else if (a.action.startsWith("CONTRACT_APPROVE")) kind = "approval";
    else if (a.action.startsWith("CONTRACT_") || a.action.startsWith("ENVELOPE_")) kind = "edit";

    entries.push({
      id: `audit:${a.id}`,
      kind,
      at: a.createdAt,
      summary: `${a.action} (${a.result})`,
      details: (a.metadata ?? {}) as Record<string, unknown>,
    });
  }

  for (const u of usages) {
    const agent = parseAgentFromOperation(u.operation);
    entries.push({
      id: `usage:${u.id}`,
      kind: agent ? "agent_complete" : "message",
      at: u.createdAt,
      agent,
      summary: `${u.operation} (${u.model}, ${u.totalTokens ?? 0} tokens, ${u.latencyMs}ms)`,
      details: {
        operation: u.operation,
        model: u.model,
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens ?? 0,
        cacheReadTokens: u.cacheReadTokens ?? 0,
        latencyMs: u.latencyMs,
        success: u.success,
        toolsUsed: u.toolsUsed,
        iterations: u.iterations ?? 1,
        errorMessage: u.errorMessage,
      },
    });
  }

  for (const c of changes) {
    entries.push({
      id: `change:${c.id}`,
      kind: c.action.includes("edit") || c.action === "clause_added" || c.action === "clause_removed" || c.action === "data_patch"
        ? "edit"
        : "tool_call",
      at: c.createdAt,
      agent: "editor",
      summary: c.summary,
      details: (c.details ?? {}) as Record<string, unknown>,
    });
  }

  return entries
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

function parseAgentFromOperation(op: string): string | undefined {
  if (op.startsWith("specialist_")) return op.slice("specialist_".length);
  if (op === "chat") return "orchestrator";
  if (op === "sentinel_classify") return "sentinel";
  if (op === "passive_open" || op === "passive_edit") return "passive";
  return undefined;
}

export interface RecordEventInput {
  orgId: string;
  userId?: string | null;
  contractId: string;
  action: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  result?: "SUCCESS" | "FAILURE" | "DENIED";
}

/**
 * Fire-and-forget — grava um evento estruturado no AuditLog com convenções
 * do schema. Erros nunca lançam (igual `recordAIUsage`).
 */
export function recordEvent(input: RecordEventInput): void {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    orgId: input.orgId,
    userId: input.userId ?? null,
    action: input.action,
    resourceType: "contract",
    resource: input.contractId,
    result: input.result ?? "SUCCESS",
    metadata: (input.metadata ?? null) as Prisma.InputJsonValue,
  };

  void prisma.auditLog
    .create({ data })
    .catch((err) => {
      console.error("[recordEvent] falhou:", err);
    });
}
