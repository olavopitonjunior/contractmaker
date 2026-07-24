/**
 * Motor de notificações do processo (venda/locação) → corretores.
 * Espelha o fan-out de lib/financeiro/notifications.ts::notifyChargeEvent.
 *
 * Canais por corretor: email (sendEmail brandado da org) e WhatsApp (sidecar
 * Newton, best-effort). Idempotência por canal×destinatário via unique do
 * DealNotificationLog (insert-first; P2002 = já enviado). Sino (Notification)
 * NÃO passa pelo log — usa o dedupe atômico próprio (type, batchId).
 *
 * OWNERSHIP DO SINO (anti double-bell): eventos cujo sino já é emitido por
 * outro módulo — contract_signed (notifyEnvelopeMilestone), charge_created/
 * charge_paid (notifyChargeEvent) — aqui só ganham o fan-out de corretores.
 * form_completed migrou pra cá (mesmo type + batchId=formId, então webhook
 * reentregue continua deduplicado contra sinos antigos).
 *
 * Fire-and-forget: NUNCA lança. Callers usam waitUntil(notifyDealEvent(...))
 * — na Vercel, `void promise()` após o response é cancelado.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { emitNotification } from "@/lib/notifications/emit";
import { sendEmail } from "@/lib/email/client";
import { DealUpdateEmail } from "@/lib/email/templates/deal-update";
import { triggerNewtonDealNotify } from "@/lib/newton/deal-notify-trigger";
import {
  resolveEffectiveNotificationConfig,
  type DealNotifEvent,
} from "./deal-events-config";
import { resolveDealBrokers, type BrokerRecipient } from "./deal-brokers";

/**
 * dedupeKey de stage_change: 1 notificação por (stage destino, dia UTC) —
 * re-drag pro mesmo stage no mesmo dia não re-envia; dia seguinte sim.
 */
export function stageChangeDedupeKey(stageId: string, when = new Date()): string {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, "0");
  const d = String(when.getUTCDate()).padStart(2, "0");
  return `${stageId}:${y}${m}${d}`;
}

export interface NotifyDealEventParams {
  dealId: string;
  orgId: string;
  event: DealNotifEvent;
  /**
   * Discriminador de idempotência por evento:
   * stage_change `${toStageId}:${yyyymmdd}` · contract_ready contractId ·
   * contract_sent envelopeId · contract_signed envelopeId · charge_* chargeId ·
   * form_completed formId · form_reminder `d${N}` ou `manual-${ts}`.
   */
  dedupeKey: string;
  context?: {
    stageName?: string | null;
    formId?: string | null;
    /** Link público do form (CTA do lembrete de preenchimento). */
    formPublicUrl?: string | null;
    extra?: Record<string, unknown>;
  };
}

/** Eventos cujo SINO org-wide é responsabilidade deste motor. */
const OWNS_BELL: Record<DealNotifEvent, boolean> = {
  stage_change: true,
  form_completed: true,
  form_reminder: true,
  contract_ready: true,
  contract_sent: true,
  contract_signed: false,
  charge_created: false,
  charge_paid: false,
};

function buildTexts(params: {
  event: DealNotifEvent;
  dealTitle: string;
  stageName?: string | null;
}): { title: string; body: string } {
  const { event, dealTitle, stageName } = params;
  const t = `"${dealTitle}"`;
  switch (event) {
    case "stage_change":
      return {
        title: "Status do negócio atualizado",
        body: stageName
          ? `O negócio ${t} avançou para o status "${stageName}".`
          : `O status do negócio ${t} foi atualizado.`,
      };
    case "form_completed":
      return {
        title: "Formulário concluído",
        body: `O formulário do negócio ${t} foi preenchido até o fim — contrato em geração.`,
      };
    case "form_reminder":
      return {
        title: "Lembrete: formulário pendente",
        body: `O formulário do negócio ${t} ainda não foi concluído. Reencaminhe o link às partes se necessário.`,
      };
    case "contract_ready":
      return {
        title: "Contrato pronto",
        body: `O contrato do negócio ${t} foi gerado e está em revisão pela imobiliária.`,
      };
    case "contract_sent":
      return {
        title: "Contrato enviado para assinatura",
        body: `O contrato do negócio ${t} foi enviado para assinatura das partes.`,
      };
    case "contract_signed":
      return {
        title: "Contrato assinado",
        body: `O contrato do negócio ${t} foi assinado por todas as partes.`,
      };
    case "charge_created":
      return {
        title: "Cobrança de comissão gerada",
        body: `A cobrança de comissão do negócio ${t} foi emitida.`,
      };
    case "charge_paid":
      return {
        title: "Comissão paga",
        body: `A cobrança de comissão do negócio ${t} foi paga.`,
      };
  }
}

/**
 * Insert-first no log (chokepoint de idempotência). Retorna o id da linha ou
 * null quando já existia (P2002) — caller pula o envio.
 */
async function claimLogRow(params: {
  orgId: string;
  dealId: string;
  event: DealNotifEvent;
  channel: "email" | "whatsapp";
  broker: BrokerRecipient;
  dedupeKey: string;
}): Promise<string | null> {
  try {
    const row = await prisma.dealNotificationLog.create({
      data: {
        orgId: params.orgId,
        dealId: params.dealId,
        event: params.event,
        channel: params.channel,
        audience: "broker",
        recipientKey: params.broker.splitRecipientId,
        recipientLabel: params.broker.label,
        dedupeKey: params.dedupeKey,
        status: "sent",
      },
    });
    return row.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return null;
    }
    throw err;
  }
}

async function settleLogRow(
  id: string,
  status: "sent" | "skipped" | "failed",
  detail?: Record<string, unknown>
): Promise<void> {
  await prisma.dealNotificationLog
    .update({
      where: { id },
      data: {
        status,
        detail: detail ? (detail as Prisma.InputJsonValue) : undefined,
      },
    })
    .catch(() => undefined);
}

export async function notifyDealEvent(
  params: NotifyDealEventParams
): Promise<void> {
  const { dealId, orgId, event, dedupeKey, context } = params;
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: {
        id: true,
        title: true,
        notificationsJson: true,
        pipeline: { select: { orgId: true, kind: true } },
        stage: { select: { name: true } },
        form: { select: { id: true, dataJson: true } },
      },
    });
    if (!deal || deal.pipeline.orgId !== orgId) return;

    const config = await resolveEffectiveNotificationConfig(
      orgId,
      deal.notificationsJson
    );
    const stageName = context?.stageName ?? deal.stage?.name ?? null;
    const texts = buildTexts({ event, dealTitle: deal.title, stageName });
    const dealPath =
      deal.pipeline.kind === "locacao"
        ? `/locacao/deals/${dealId}`
        : `/deals/${dealId}`;

    // ── Sino (usuários da plataforma) ───────────────────────────────────────
    if (OWNS_BELL[event]) {
      // form_completed preserva o par (type, batchId) histórico — sinos já
      // emitidos antes desta feature continuam deduplicando re-finalize.
      const type = event === "form_completed" ? "form_completed" : `deal_${event}`;
      const batchId =
        event === "form_completed" && (context?.formId ?? deal.form?.id)
          ? (context?.formId ?? deal.form!.id)
          : `deal-${event}-${dealId}-${dedupeKey}`;
      await emitNotification({
        orgId,
        type,
        title: texts.title,
        body: texts.body,
        linkUrl: dealPath,
        metadata: { dealId, event, ...(context?.extra ?? {}) },
        batchId,
      });
    }

    // ── Corretores (email + WhatsApp) ───────────────────────────────────────
    if (config.muted) return;
    const eventCfg = config.events[event];
    if (!eventCfg.broker.email && !eventCfg.broker.whatsapp) return;

    const brokers = await resolveDealBrokers({
      orgId,
      formDataJson: deal.form?.dataJson ?? null,
      brokerIds: config.brokerIds,
    });
    if (brokers.length === 0) return;

    const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";

    for (const broker of brokers) {
      // Email
      if (eventCfg.broker.email && broker.notifyByEmail && broker.email) {
        const logId = await claimLogRow({
          orgId,
          dealId,
          event,
          channel: "email",
          broker,
          dedupeKey,
        });
        if (logId) {
          const result = await sendEmail({
            to: broker.email,
            subject: `${texts.title} — ${deal.title}`,
            react: DealUpdateEmail({
              recipientName: broker.label,
              eventTitle: texts.title,
              eventBody: texts.body,
              dealTitle: deal.title,
              stageName: event === "stage_change" ? stageName : undefined,
              ctaUrl:
                event === "form_reminder"
                  ? (context?.formPublicUrl ?? null)
                  : null,
              ctaLabel: event === "form_reminder" ? "Abrir formulário" : null,
            }),
            orgId,
            tags: [
              { name: "kind", value: "deal-notify" },
              { name: "event", value: event },
            ],
          });
          if (!result.ok) {
            await settleLogRow(logId, "failed", {
              error: result.error ?? "envio recusado",
            });
          }
        }
      }

      // WhatsApp (Newton sidecar — best-effort)
      if (eventCfg.broker.whatsapp && broker.notifyByWhatsapp && broker.phone) {
        const logId = await claimLogRow({
          orgId,
          dealId,
          event,
          channel: "whatsapp",
          broker,
          dedupeKey,
        });
        if (logId) {
          const outcome = await triggerNewtonDealNotify({
            orgId,
            dealId,
            phone: broker.phone,
            recipientName: broker.label,
            message: `${texts.title}: ${texts.body} Acompanhe em ${baseUrl}${dealPath}`,
          });
          if (outcome === "skipped") {
            await settleLogRow(logId, "skipped", {
              reason: "newton_gate_off_ou_sidecar_ausente",
            });
          } else {
            await settleLogRow(logId, "sent", { via: "newton_sidecar" });
          }
        }
      }
    }
  } catch (err) {
    console.error(
      `[deal-events] notifyDealEvent(${params.event}, deal ${params.dealId}) falhou:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
