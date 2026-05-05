import { prisma } from "@/lib/db/prisma";

/**
 * Telemetry de chamadas Newton API — uma linha por request, capturada
 * pelo wrapper `withApi`.
 *
 * Fire-and-forget: nunca bloqueia request, nunca lança exceção.
 *
 * Cleanup: cron diário deleta > 90 dias via /api/cron/api-usage/cleanup.
 */

export interface RecordApiUsageInput {
  orgId: string;
  userId: string;
  tokenId?: string | null;
  via: "session" | "bearer";
  method: string;
  /** Path normalizado: /api/deals/:id (sem id real). Reduz cardinalidade. */
  path: string;
  statusCode: number;
  latencyMs: number;
  errorCode?: string | null;
}

export async function recordApiUsage(input: RecordApiUsageInput): Promise<void> {
  try {
    await prisma.apiUsage.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        tokenId: input.tokenId ?? null,
        via: input.via,
        method: input.method,
        path: input.path,
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode ?? null,
      },
    });
  } catch (err) {
    console.error(
      "[api-usage] falha ao gravar telemetry:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Cleanup pra cron diário. */
export async function cleanupOldApiUsage(daysToKeep = 90): Promise<number> {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  const result = await prisma.apiUsage.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
