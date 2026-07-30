/**
 * F4 — Notification emission helper.
 *
 * Fire-and-forget API: callers never await for correctness, never see errors.
 * Follows the same pattern as `recordAIUsage` — a failed notification insert
 * should never propagate to the user's workflow. Swallowed errors are logged
 * to console for observability.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export interface EmitNotificationParams {
  orgId: string;
  userId?: string | null;
  type: string; // "certidao_batch_complete" | "certidao_ready" | "certidao_failed"
  title: string;
  body: string;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
  /**
   * I.5 (Phase I, 2026-04-18) — quando presente, DB unique constraint
   * (type, batchId) garante dedupe atômico. Duplicatas viram no-op.
   */
  batchId?: string | null;
  /**
   * Gerente (2026-07) — quando presente, o deal com gerente atribuído ganha
   * uma SEGUNDA row direcionada (`userId = managerUserId`, batchId com sufixo
   * ":mgr" pra preservar o dedupe (type, batchId)). É o que faz o sino do
   * gerente funcionar: a leitura dele é restrita a rows direcionadas
   * (GET /api/notifications) e o fan-out na escrita é O(1) por evento.
   * Passar dealId é o OPT-IN do call site de que esta é uma notificação de
   * PROCESSO do negócio (o gerente deve saber) — vale também quando a row
   * principal é direcionada a outra pessoa (ex.: certidões → criador do job).
   * Se o alvo direcionado JÁ é o gerente, não duplica.
   */
  dealId?: string | null;
}

/**
 * Creates a Notification row. Safe to call without awaiting — the promise
 * never rejects. If the DB call fails, the error is logged but swallowed.
 *
 * Idempotency:
 * - When `batchId` is set, duplicate inserts (same type + batchId) raise
 *   Prisma P2002 and are silently swallowed — resolves the "5 notifs for
 *   same batchId" bug from the 2026-04-18 QA.
 * - Otherwise, caller is responsible (e.g. checking by other criteria).
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
        batchId: params.batchId ?? null,
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation (type + batchId duplicado).
    // É exatamente o comportamento desejado — outro worker já emitiu.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return;
    }
    console.error(
      "[notifications.emit] failed:",
      err instanceof Error ? err.message : String(err),
      "params:",
      { type: params.type, orgId: params.orgId }
    );
  }

  // Fan-out pro GERENTE do deal (row direcionada). Fora do try principal de
  // propósito: falha aqui não pode mascarar o sucesso/erro da row principal.
  if (params.dealId) {
    try {
      const deal = await prisma.deal.findUnique({
        where: { id: params.dealId },
        select: { managerUserId: true, pipeline: { select: { orgId: true } } },
      });
      // Guard cross-org: dealId de outra org não arrasta gerente alheio.
      // Alvo direcionado já é o gerente → sem duplicata.
      if (
        deal?.managerUserId &&
        deal.pipeline.orgId === params.orgId &&
        deal.managerUserId !== params.userId
      ) {
        await prisma.notification.create({
          data: {
            orgId: params.orgId,
            userId: deal.managerUserId,
            type: params.type,
            title: params.title.slice(0, 200),
            body: params.body.slice(0, 500),
            linkUrl: params.linkUrl,
            metadata: (params.metadata as object) ?? undefined,
            batchId: params.batchId ? `${params.batchId}:mgr` : null,
          },
        });
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return;
      }
      console.error(
        "[notifications.emit] manager fan-out failed:",
        err instanceof Error ? err.message : String(err),
        "params:",
        { type: params.type, orgId: params.orgId, dealId: params.dealId }
      );
    }
  }
}
