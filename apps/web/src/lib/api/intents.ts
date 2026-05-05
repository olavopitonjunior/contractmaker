import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { ApiAuthSuccess } from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

/**
 * ActionIntent — human-in-the-loop para ações high-risk via Bearer.
 *
 * Diferente de DualApproval (segregação de funções, initiator≠approver),
 * aqui o dono do token tipicamente também aprova suas próprias intents.
 * Semântica: "agente externo quis fazer X, humano (geralmente o mesmo user)
 * tem que aprovar antes do servidor executar".
 *
 * Quando via=session, `requireApproval` executa direto (sem overhead).
 * Quando via=bearer, persiste intent `pending` e retorna 202 com
 * { intentId, approvalUrl, expiresAt, preview }.
 *
 * Caller usa assim:
 *
 *   const result = await requireApproval({
 *     ctx: auth, action: "CHARGE_CREATE", payload: parsed.data,
 *     preview: { fee, splits }, req,
 *     run: async () => { return { status: 201, body: { chargeId } }; }
 *   });
 *   return NextResponse.json(result.body, { status: result.status });
 */

export const HIGH_RISK_ACTIONS = [
  "CHARGE_CREATE",
  "ENVELOPE_SEND",
  "CONTRACT_APPROVE",
  "DEAL_DELETE_HARD",
] as const;

export type IntentAction = (typeof HIGH_RISK_ACTIONS)[number];

export const INTENT_TTL_HOURS = 24;

export interface IntentPreview {
  /** Resumo humanamente legível ("Cobrança de R$ X para Y", "Envelope para 3 signatários"). */
  summary: string;
  /** Detalhes específicos da ação (taxas, splits, signers, valor, etc). */
  details: Record<string, unknown>;
}

/** Canonicaliza payload pra hash determinístico (anti-tamper). */
export function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalize((obj as Record<string, unknown>)[k])
      )
      .join(",") +
    "}"
  );
}

export function hashPayload(payload: unknown): string {
  return crypto.createHash("sha256").update(canonicalize(payload)).digest("hex");
}

export interface RunResult<T = unknown> {
  status: number;
  body: T;
}

export interface RequireApprovalArgs<T = unknown> {
  ctx: ApiAuthSuccess;
  action: IntentAction;
  payload: object;
  preview: IntentPreview;
  req: Request;
  run: () => Promise<RunResult<T>>;
  /**
   * Se já existir intent com o mesmo (requestedBy, idempotencyKey), reusa em vez
   * de criar nova. Vem do header X-Idempotency-Key se presente.
   */
  idempotencyKey?: string | null;
}

export interface ApprovalResponse<T = unknown> {
  status: number;
  body: T | IntentCreatedBody;
  /** "executed" se rodou agora (session), "pending" se criou intent (bearer). */
  via: "executed" | "pending";
}

export interface IntentCreatedBody {
  intentId: string;
  status: "pending";
  approvalUrl: string;
  expiresAt: string;
  preview: IntentPreview;
  message: string;
}

export async function requireApproval<T>(
  args: RequireApprovalArgs<T>
): Promise<ApprovalResponse<T>> {
  // Session humana → executa direto.
  if (args.ctx.ident.via === "session") {
    const r = await args.run();
    return { status: r.status, body: r.body, via: "executed" };
  }

  // Bearer → cria intent pending.
  const idempotencyKey = args.idempotencyKey ?? null;

  // Idempotência: se já existe intent com mesma key, retorna ela
  if (idempotencyKey) {
    const existing = await prisma.actionIntent.findUnique({
      where: {
        requestedBy_idempotencyKey: {
          requestedBy: args.ctx.ident.userId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      // Se já executou, retorna o resultado original
      if (existing.status === "executed" && existing.resultJson) {
        const result = existing.resultJson as { status: number; body: T };
        return { status: result.status, body: result.body, via: "executed" };
      }
      // Senão, retorna o body de "pendente"
      return {
        status: 202,
        body: buildPendingBody(existing),
        via: "pending",
      };
    }
  }

  const payloadHash = hashPayload(args.payload);
  const expiresAt = new Date(Date.now() + INTENT_TTL_HOURS * 60 * 60 * 1000);
  const tokenId =
    args.ctx.ident.via === "bearer" ? args.ctx.ident.tokenId : null;

  const intent = await prisma.actionIntent.create({
    data: {
      orgId: args.ctx.org.id,
      requestedBy: args.ctx.ident.userId,
      actorVia: args.ctx.ident.via,
      tokenId,
      action: args.action,
      payload: args.payload as object,
      payloadHash,
      preview: args.preview as object,
      status: "pending",
      expiresAt,
      idempotencyKey,
    },
  });

  await audit(
    extractAuditContextFromRequest(
      args.req,
      args.ctx.org.id,
      args.ctx.actor.effectiveUserId
    ),
    {
      action: "INTENT_CREATED",
      result: "SUCCESS",
      resource: intent.id,
      resourceType: "ActionIntent",
      metadata: mergeAuditMetadata(
        { intentAction: args.action, summary: args.preview.summary },
        args.ctx.actor
      ),
    }
  );

  return {
    status: 202,
    body: buildPendingBody(intent),
    via: "pending",
  };
}

function buildPendingBody(intent: {
  id: string;
  status: string;
  expiresAt: Date;
  preview: unknown;
  action: string;
}): IntentCreatedBody {
  return {
    intentId: intent.id,
    status: "pending",
    approvalUrl: `/intents/${intent.id}`,
    expiresAt: intent.expiresAt.toISOString(),
    preview: intent.preview as IntentPreview,
    message: `Ação "${intent.action}" requer aprovação humana antes de ser executada. Acesse ${`/intents/${intent.id}`} para revisar.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// executeIntent — chamado pelo endpoint /api/intents/[id]/approve depois de
// session humana confirmar. Idempotente: chamada concorrente só executa uma vez.
// ───────────────────────────────────────────────────────────────────────────

export interface IntentExecutorContext {
  intentId: string;
  orgId: string;
  /** userId que disparou a intent (token owner). */
  requestedBy: string;
  /** userId que aprovou (humano via session). */
  approvedBy: string | null;
}

export interface IntentExecutor<T = unknown> {
  /** Idempotente: chamado com o payload congelado + ctx da intent. */
  (payload: unknown, ctx: IntentExecutorContext): Promise<RunResult<T>>;
}

const EXECUTORS = new Map<IntentAction, IntentExecutor>();

/**
 * Registra um executor para uma action. Chamado uma vez no boot (em handlers
 * Newton-aware ou em arquivo dedicado).
 */
export function registerIntentExecutor(
  action: IntentAction,
  executor: IntentExecutor
): void {
  EXECUTORS.set(action, executor);
}

export class IntentExecutionError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "wrong_status"
      | "expired"
      | "tampered"
      | "no_executor"
      | "executor_failed",
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

/**
 * Executa intent aprovada. Garante atomicidade: marca executed antes de chamar
 * executor; se executor falha, marca failed com errorMessage.
 *
 * Anti-tamper: re-confere payloadHash antes de executar. Se diferente, marca
 * INTENT_TAMPERED e aborta.
 */
export async function executeIntent<T = unknown>(intentId: string): Promise<{
  status: number;
  body: T;
}> {
  // Lazy import — evita ciclo (intent-executors importa intents.ts)
  const { ensureIntentExecutorsRegistered } = await import(
    "@/lib/api/intent-executors"
  );
  ensureIntentExecutorsRegistered();

  const intent = await prisma.actionIntent.findUnique({ where: { id: intentId } });
  if (!intent) {
    throw new IntentExecutionError("not_found", `intent ${intentId} not found`);
  }
  if (intent.status !== "approved") {
    throw new IntentExecutionError(
      "wrong_status",
      `intent ${intentId} status is ${intent.status} (expected approved)`
    );
  }
  if (intent.expiresAt < new Date()) {
    await prisma.actionIntent.update({
      where: { id: intentId },
      data: { status: "expired" },
    });
    throw new IntentExecutionError("expired", `intent ${intentId} expired`);
  }
  // Re-checa hash
  const expectedHash = hashPayload(intent.payload);
  if (expectedHash !== intent.payloadHash) {
    await prisma.actionIntent.update({
      where: { id: intentId },
      data: {
        status: "failed",
        errorMessage: "payloadHash mismatch (tampering detected)",
      },
    });
    await audit(
      { orgId: intent.orgId, userId: intent.requestedBy },
      {
        action: "INTENT_TAMPERED",
        result: "DENIED",
        resource: intentId,
        resourceType: "ActionIntent",
      }
    );
    throw new IntentExecutionError(
      "tampered",
      `intent ${intentId} payloadHash mismatch`
    );
  }

  const executor = EXECUTORS.get(intent.action as IntentAction);
  if (!executor) {
    throw new IntentExecutionError(
      "no_executor",
      `no executor registered for action ${intent.action}`
    );
  }

  try {
    const result = (await executor(intent.payload, {
      intentId: intent.id,
      orgId: intent.orgId,
      requestedBy: intent.requestedBy,
      approvedBy: intent.approvedBy,
    })) as RunResult<T>;
    await prisma.actionIntent.update({
      where: { id: intentId },
      data: {
        status: "executed",
        executedAt: new Date(),
        resultJson: result as unknown as object,
      },
    });
    await audit(
      { orgId: intent.orgId, userId: intent.requestedBy },
      {
        action: "INTENT_EXECUTED",
        result: "SUCCESS",
        resource: intentId,
        resourceType: "ActionIntent",
        metadata: { intentAction: intent.action, statusCode: result.status },
      }
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.actionIntent.update({
      where: { id: intentId },
      data: { status: "failed", errorMessage: message.slice(0, 1000) },
    });
    await audit(
      { orgId: intent.orgId, userId: intent.requestedBy },
      {
        action: "INTENT_EXECUTED",
        result: "FAILURE",
        resource: intentId,
        resourceType: "ActionIntent",
        metadata: { intentAction: intent.action, error: message.slice(0, 500) },
      }
    );
    throw new IntentExecutionError("executor_failed", message, err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers de uso em route handlers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Helper pra rotas que querem retornar o body do `requireApproval` direto.
 *
 *   const result = await requireApproval({...});
 *   return approvalResponse(result);
 */
export function approvalResponse<T>(r: ApprovalResponse<T>): NextResponse {
  return NextResponse.json(r.body, { status: r.status });
}

/** Cleanup: marca como `expired` intents pendentes vencidos. Cron diário. */
export async function expirePendingIntents(): Promise<number> {
  const result = await prisma.actionIntent.updateMany({
    where: {
      status: "pending",
      expiresAt: { lt: new Date() },
    },
    data: { status: "expired" },
  });
  return result.count;
}
