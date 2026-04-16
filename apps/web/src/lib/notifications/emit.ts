/**
 * F4 — Notification emission helper.
 *
 * Fire-and-forget API: callers never await for correctness, never see errors.
 * Follows the same pattern as `recordAIUsage` — a failed notification insert
 * should never propagate to the user's workflow. Swallowed errors are logged
 * to console for observability.
 */
import { prisma } from "@/lib/db/prisma";

export interface EmitNotificationParams {
  orgId: string;
  userId?: string | null;
  type: string; // "certidao_batch_complete" | "certidao_ready" | "certidao_failed"
  title: string;
  body: string;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Creates a Notification row. Safe to call without awaiting — the promise
 * never rejects. If the DB call fails, the error is logged but swallowed.
 *
 * IMPORTANT: idempotency must be handled by the caller before calling this.
 * See `checkBatchCompletion` in executor.ts for the batch-aggregated pattern
 * that checks for existing notifications by metadata.batchId before emitting.
 */
export async function emitNotification(
  params: EmitNotificationParams
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        orgId: params.orgId,
        userId: params.userId ?? null,
        type: params.type,
        title: params.title.slice(0, 200),
        body: params.body.slice(0, 500),
        linkUrl: params.linkUrl,
        metadata: (params.metadata as object) ?? undefined,
      },
    });
  } catch (err) {
    console.error(
      "[notifications.emit] failed:",
      err instanceof Error ? err.message : String(err),
      "params:",
      { type: params.type, orgId: params.orgId }
    );
  }
}
