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
import { autoPromoteDealOnCommissionPaid } from "@/lib/contracts/auto-promote-commission";
import { notifyDealEvent } from "@/lib/notifications/deal-events";

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
    const eventName = payload.event as string;
    let inferredOrgId: string | null = null;
    let inferredAccountId: string | null = null;

    // 2a) ACCOUNT_STATUS_UPDATED: atualiza status da AsaasAccount em si.
    //     Substitui o refresh manual que era feito via /onboarding/refresh.
    if (eventName === "ACCOUNT_STATUS_UPDATED") {
      const externalAsaasId = (payload as any).account?.id as string | undefined;
      if (externalAsaasId) {
        const acc = await prisma.asaasAccount.findFirst({
          where: { asaasId: externalAsaasId },
          select: {
            id: true,
            orgId: true,
            status: true,
          },
        });
        if (acc) {
          inferredOrgId = acc.orgId;
          inferredAccountId = acc.id;
          const statusPayload = (payload as any).account?.status ?? {};
          const updateData: Record<string, unknown> = {
            lastStatusCheckAt: new Date(),
          };
          if (typeof statusPayload.general === "string")
            updateData.generalStatus = statusPayload.general;
          if (typeof statusPayload.documentation === "string")
            updateData.documentationStatus = statusPayload.documentation;
          if (typeof statusPayload.commercialInfo === "string")
            updateData.commercialInfoStatus = statusPayload.commercialInfo;
          if (typeof statusPayload.bankAccountInfo === "string")
            updateData.bankAccountInfoStatus = statusPayload.bankAccountInfo;
          // Mapeamento canonical → AsaasAccount.status
          if (statusPayload.general === "APPROVED" && acc.status !== "APPROVED") {
            updateData.status = "APPROVED";
            updateData.approvedAt = new Date();
          } else if (
            statusPayload.general === "REJECTED" &&
            acc.status !== "REJECTED"
          ) {
            updateData.status = "REJECTED";
          } else if (
            statusPayload.general === "PENDING" &&
            acc.status === "PENDING" &&
            (statusPayload.documentation === "PENDING" ||
              statusPayload.commercialInfo === "PENDING")
          ) {
            updateData.status = "AWAITING_APPROVAL";
          }
          await prisma.asaasAccount.update({
            where: { id: acc.id },
            data: updateData,
          });
        }
      }
    }

    // 2b) TRANSFER_*: lookup via asaasTransfer.findUnique
    if (!inferredOrgId && (payload as any).transfer?.id) {
      const transfer = await prisma.asaasTransfer.findUnique({
        where: { asaasTransferId: (payload as any).transfer.id },
        select: { orgId: true, accountId: true },
      });
      if (transfer) {
        inferredOrgId = transfer.orgId;
        inferredAccountId = transfer.accountId;
      }
    }

    if (!inferredOrgId) {
      return {
        eventId: payload.id,
        processed: false,
        reason: `non-payment event ${eventName} without inferable orgId — skipped`,
      };
    }

    await prisma.asaasWebhookEvent.upsert({
      where: { asaasEventId: payload.id },
      create: {
        orgId: inferredOrgId,
        accountId: inferredAccountId,
        asaasEventId: payload.id,
        event: eventName,
        payloadJson: payload as any,
        processedAt: new Date(),
      },
      update: {
        processedAt: new Date(),
        processingError: null,
        accountId: inferredAccountId,
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
    // accountId é a chave per-conta; precisamos pra popular AsaasWebhookEvent
    // e pra dispatchExternalSplits abaixo (que precisa da apiKey da conta certa).
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
        accountId: charge.accountId,
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
        accountId: charge.accountId,
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
    // Auto-promove o deal pra "Comissão paga" — o único estágio que exigia
    // clique manual apesar de o webhook já saber do pagamento. Guard interno
    // (só de "Cobrança emitida"/"Contrato assinado") + no-op se não houver deal
    // ou stage. Inline pela mesma razão do dispatch (serverless aborta o após).
    // SÓ pra charge de comissão: uma avulsa/aluguel (kind != "commission") paga
    // no mesmo deal NÃO significa que a comissão foi paga → não promove.
    if (charge.kind === "commission") {
      await autoPromoteDealOnCommissionPaid(charge.dealId);
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

  // Notificação do processo → corretores: comissão paga. SINO pertence ao
  // notifyChargeEvent acima (OWNS_BELL=false). Só kind="commission" — avulsa/
  // aluguel paga não é "comissão paga". Inline pela razão serverless acima;
  // notifyDealEvent nunca lança. dedupeKey=charge.id (webhook reentregue no-op).
  if (notifEvent === "paid" && charge.kind === "commission" && charge.dealId) {
    await notifyDealEvent({
      dealId: charge.dealId,
      orgId: charge.orgId,
      event: "charge_paid",
      dedupeKey: charge.id,
      context: { extra: { chargeId: charge.id } },
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
