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
 * Idempotente: se asaasEventId já persistido, retorna sem reprocessar.
 */
export async function applyWebhookToCharge(
  payload: AsaasWebhookPayload,
  rawHeaders?: Record<string, string>
): Promise<ApplyWebhookResult> {
  // 1. Dedupe via @unique asaasEventId
  const existing = await prisma.asaasWebhookEvent.findUnique({
    where: { asaasEventId: payload.id },
  });
  if (existing) {
    return {
      eventId: payload.id,
      processed: false,
      reason: "duplicate (already processed)",
    };
  }

  // 2. Se não é evento de payment, persiste log mas não atualiza charge
  if (!payload.payment?.id) {
    // Precisamos do orgId — sem payment, não conseguimos inferir.
    // Em Fase 1b só lidamos com PAYMENT_* eventos. Outros (TRANSFER_*, ACCOUNT_*)
    // são logados em fase futura.
    return {
      eventId: payload.id,
      processed: false,
      reason: "no payment payload — non-payment events logged only in Fase 3+",
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

  // 4. Update charge (transactional com insert do event)
  await prisma.$transaction(async (tx) => {
    await tx.asaasWebhookEvent.create({
      data: {
        orgId: charge.orgId,
        asaasEventId: payload.id,
        event: eventName,
        asaasPaymentId,
        chargeId: charge.id,
        payloadJson: payload as any,
        processedAt: new Date(),
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
