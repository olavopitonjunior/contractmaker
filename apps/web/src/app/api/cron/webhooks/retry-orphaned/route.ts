import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import {
  applyWebhookToCharge,
  parseWebhookPayload,
} from "@/lib/asaas/webhook";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/webhooks/retry-orphaned
 *
 * Phase 1 (production prep) — sweep diário de webhooks Asaas que
 * (a) ficaram sem `processedAt` (handler crashou antes de fechar) ou
 * (b) tem `processingError` populado (falha transitória).
 *
 * Re-aplica `applyWebhookToCharge` em modo `force` que:
 *   - skip se evento já foi processedAt sem error (sucesso confirmado);
 *   - reprocessa caso contrário, atualizando processedAt + limpando error.
 *
 * Limite 50 entries por run para evitar timeout. Schedule via vercel.json:
 *   `0 3 * * *` (diário 3am UTC = 0am BRT).
 *
 * Auth: opcional via `CRON_SECRET` em Authorization header. Sem auth
 * funciona em dev local; em prod recomenda-se setar a env.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/webhooks/retry-orphaned"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/webhooks/retry-orphaned" });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const orphans = await prisma.asaasWebhookEvent.findMany({
    where: {
      OR: [
        // Nunca processado E recebido há > 1h (evita race com handler em
        // andamento)
        { processedAt: null, receivedAt: { lt: oneHourAgo } },
        // Tem erro registrado — sempre re-tentar
        { processingError: { not: null } },
      ],
    },
    orderBy: { receivedAt: "asc" },
    take: 50,
  });

  if (orphans.length === 0) {
    return NextResponse.json({ ok: true, swept: 0, processed: 0, failed: 0 });
  }

  let processed = 0;
  let failed = 0;
  const errors: Array<{ eventId: string; reason: string }> = [];

  for (const orphan of orphans) {
    const payload = parseWebhookPayload(orphan.payloadJson);
    if (!payload) {
      // Payload inválido — não vamos conseguir re-aplicar. Marca como
      // "abandonado" via processingError pra parar de aparecer no sweep.
      await prisma.asaasWebhookEvent.update({
        where: { id: orphan.id },
        data: {
          processedAt: new Date(),
          processingError: "ABANDONED: payload inválido durante retry",
        },
      });
      failed++;
      errors.push({
        eventId: orphan.asaasEventId,
        reason: "invalid payload",
      });
      continue;
    }

    try {
      const result = await applyWebhookToCharge(payload, {
        force: true,
        origin: "cron-retry",
      });
      if (result.processed) {
        processed++;
      } else {
        // Tentou mas processed=false (ex: charge não existe localmente).
        // Marca como abandonado para sair do sweep.
        await prisma.asaasWebhookEvent.update({
          where: { id: orphan.id },
          data: {
            processedAt: new Date(),
            processingError: `ABANDONED: ${result.reason ?? "unknown"}`,
          },
        });
        failed++;
        errors.push({
          eventId: orphan.asaasEventId,
          reason: result.reason ?? "no progress",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.asaasWebhookEvent.update({
        where: { id: orphan.id },
        data: { processingError: message.slice(0, 500) },
      });
      failed++;
      errors.push({ eventId: orphan.asaasEventId, reason: message });
    }
  }

  return NextResponse.json({
    ok: true,
    swept: orphans.length,
    processed,
    failed,
    errors: errors.slice(0, 10), // limit para não estourar payload
  });
}
