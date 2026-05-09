/**
 * Webhook handler para eventos Asaas.
 *
 * Fluxo:
 *  1. Rota recebe POST /api/webhooks/asaas
 *  2. Valida header `asaas-access-token` contra ASAAS_WEBHOOK_TOKEN (timingSafeEqual)
 *  3. Parse payload
 *  4. Upsert AsaasWebhookEvent (@unique id → idempotência)
 *  5. Se event.payment, atualiza CommissionCharge.status
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  type AsaasWebhookPayload,
  type AsaasWebhookEventName,
  mapAsaasStatusToInternal,
} from "./types";
import { dispatchExternalSplits } from "./splitDispatcher";
import { notifyChargeEvent, type ChargeEvent } from "@/lib/financeiro/notifications";

export function validateWebhookToken(headerToken: string | null): boolean {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected) return false; // exigir config explícita
  if (!headerToken) return false;
  const a = Buffer.from(headerToken);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parse seguro do payload — rejeita se faltar campos críticos.
 */
export function parseWebhookPayload(body: unknown): AsaasWebhookPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || typeof b.event !== "string") return null;
  return b as unknown as AsaasWebhookPayload;
}

export interface ApplyWebhookResult {
  eventId: string;
  processed: boolean;
  reason?: string;
  chargeId?: string;
}

/**
 * Aplica evento ao CommissionCharge correspondente.
 *
 * Idempotente: se asaasEventId já persistido E processedAt populado, retorna
 * sem reprocessar. Quando `force=true` (chamado pelo cron de retry de
 * webhooks órfãos), reprocessa mesmo se evento existir mas com
 * `processingError` — útil para recuperação de falhas transitórias.
 */
export interface ApplyWebhookOptions {
  /** Quando true, ignora dedupe e re-aplica em eventos com processingError. */
  force?: boolean;
  /** Origin do call para auditoria/debug ("webhook" | "cron-retry"). */
  origin?: "webhook" | "cron-retry";
}

export async function applyWebhookToCharge(
  payload: AsaasWebhookPayload,
  options: ApplyWebhookOptions = {}
): Promise<ApplyWebhookResult> {
  const { force = false } = options;

  // 1. Dedupe via @unique asaasEventId
  //    - Sem force: skip se já existe (qualquer estado).
  //    - Com force: skip apenas se já está processedAt && sem error (sucesso confirmado).
  const existing = await prisma.asaasWebhookEvent.findUnique({
    where: { asaasEventId: payload.id },
  });
  if (existing) {
    const isSuccessfullyProcessed =
      existing.processedAt !== null && !existing.processingError;
    if (!force || isSuccessfullyProcessed) {
      return {
        eventId: payload.id,
        processed: false,
        reason: force
          ? "already successfully processed (force skipped)"
          : "duplicate (already processed)",
      };
    }
    // force=true e (processedAt null OU processingError não-null) → reprocessar.
  }

  // 2. Eventos não-PAYMENT — persiste log + processedAt para evitar acúmulo.
  //    Útil para TRANSFER_*, ACCOUNT_STATUS_UPDATED, etc. Não atualiza charge
  //    porque não há paymentId; mas evita ficar "órfão" pro cron.
  if (!payload.payment?.id) {
    // Inferir orgId: para TRANSFER_*, payload pode trazer transfer.id que
    // já temos local em AsaasTransfer.asaasTransferId. Caso contrário,
    // logamos sem orgId (campo é obrigatório no schema atual; usamos null
    // se não houver — quando schema permitir — ou skip).
    const eventName = payload.event as string;
    let inferredOrgId: string | null = null;

    // Tenta inferir orgId via transfer
    if ((payload as any).transfer?.id) {
      const transfer = await prisma.asaasTransfer.findUnique({
        where: { asaasTransferId: (payload as any).transfer.id },
        select: { orgId: true },
      });
      if (transfer) inferredOrgId = transfer.orgId;
    }

    if (!inferredOrgId) {
      // Sem orgId, não conseguimos persistir (FK obrigatório).
      // Retorna processed: false com razão clara — cron de retry vai
      // ignorar entries que nunca foram inseridas.
      return {
        eventId: payload.id,
        processed: false,
        reason: `non-payment event ${eventName} without inferable orgId — skipped`,
      };
    }

    // Upsert para evitar P2002 em retry
    await prisma.asaasWebhookEvent.upsert({
      where: { asaasEventId: payload.id },
      create: {
        orgId: inferredOrgId,
        asaasEventId: payload.id,
        event: eventName,
        payloadJson: payload as any,
        processedAt: new Date(),
      },
      update: {
        processedAt: new Date(),
        processingError: null,
      },
    });

    return {
      eventId: payload.id,
      processed: true,
      reason: `non-payment event ${eventName} logged`,
    };
  }

  const asaasPaymentId = payload.payment.id;

  // 3. Encontra CommissionCharge
  const charge = await prisma.commissionCharge.findUnique({
    where: { asaasPaymentId },
  });

  if (!charge) {
    // Charge não existe localmente — pode ser cobrança gerada fora do Contractmaker
    // (ex: manualmente no dashboard Asaas). Persiste o evento para auditoria
    // mas não faz update.
    return {
      eventId: payload.id,
      processed: false,
      reason: `charge ${asaasPaymentId} not found locally`,
    };
  }

  const internalStatus = mapAsaasStatusToInternal(payload.payment.status);
  const eventName = payload.event as AsaasWebhookEventName;

  // 4. Update charge (transactional com upsert do event — `upsert` para tolerar
  //    re-tentativa em modo force, mantendo idempotência)
  await prisma.$transaction(async (tx) => {
    await tx.asaasWebhookEvent.upsert({
      where: { asaasEventId: payload.id },
      create: {
        orgId: charge.orgId,
        asaasEventId: payload.id,
        event: eventName,
        asaasPaymentId,
        chargeId: charge.id,
        payloadJson: payload as any,
        processedAt: new Date(),
      },
      update: {
        processedAt: new Date(),
        processingError: null,
      },
    });

    const now = new Date();
    const updateData: any = {
      status: internalStatus,
      asaasStatus: payload.payment!.status,
      lastEventAt: now,
    };

    // Datas específicas por evento
    if (eventName === "PAYMENT_RECEIVED" || eventName === "PAYMENT_CONFIRMED") {
      if (payload.payment?.paymentDate) {
        updateData.paidAt = new Date(payload.payment.paymentDate);
      } else if (!charge.paidAt) {
        updateData.paidAt = now;
      }
    }
    if (eventName === "PAYMENT_REFUNDED" && !charge.refundedAt) {
      updateData.refundedAt = now;
    }
    if (eventName === "PAYMENT_DELETED" && !charge.cancelledAt) {
      updateData.cancelledAt = now;
    }

    // netValue vem no evento RECEIVED
    if (payload.payment?.netValue && !charge.netValue) {
      updateData.netValue = payload.payment.netValue;
    }

    await tx.commissionCharge.update({
      where: { id: charge.id },
      data: updateData,
    });
  });

  // Fase 6: dispatch de splits PIX externos pós-pagamento.
  // Aguardar inline antes de retornar — em serverless (Vercel/Lambda),
  // promises fire-and-forget após response.send() são abortadas e
  // os splits ficam órfãos. Falhas individuais ficam em
  // AsaasTransfer.failureReason para retry manual via UI.
  if (eventName === "PAYMENT_RECEIVED" || eventName === "PAYMENT_CONFIRMED") {
    try {
      await dispatchExternalSplits(charge.id);
    } catch (err) {
      console.error(
        `[webhook] dispatchExternalSplits failed for charge ${charge.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Régua interna (Pagadoria 2026-05-09): fan-out por evento. Inline
  // pra mesma razão do dispatch — Vercel aborta promises pós-response.
  // notifyChargeEvent é fire-and-forget interno (try/catch ao redor).
  const eventToNotif: Partial<Record<string, ChargeEvent>> = {
    PAYMENT_CREATED: "created",
    PAYMENT_RECEIVED: "paid",
    PAYMENT_CONFIRMED: "paid",
    PAYMENT_OVERDUE: "overdue",
    PAYMENT_REFUNDED: "refunded",
    PAYMENT_DELETED: "cancelled",
  };
  const notifEvent = eventToNotif[eventName];
  if (notifEvent) {
    await notifyChargeEvent({
      chargeId: charge.id,
      event: notifEvent,
      orgId: charge.orgId,
    });
  }

  return {
    eventId: payload.id,
    processed: true,
    chargeId: charge.id,
  };
}

// Opcional: HMAC signing para extra-security em rotas onde o token pode
// ser comprometido. Não usado no Asaas oficialmente mas disponível se
// quisermos validar que a mensagem não foi alterada em trânsito.
export function computeHmac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
