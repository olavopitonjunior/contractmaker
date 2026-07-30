/**
 * Motor de notificações do processo (venda/locação) → corretores e PARTES.
 * Espelha o fan-out de lib/financeiro/notifications.ts::notifyChargeEvent.
 *
 * Dois públicos, textos e transportes diferentes:
 *  - `broker` (v1): quem trabalha o negócio. Email brandado + WhatsApp direto
 *    pelo sidecar Newton (`triggerNewtonDealNotify`). Default: email ligado.
 *  - `party` (v2): o cliente final (comprador/vendedor, locador/locatário).
 *    Email com template próprio + WhatsApp SÓ via NewtonRequest one-shot e SÓ
 *    em tenant com Newton. Default: tudo DESLIGADO, e só nos eventos da
 *    allowlist `PARTY_CAPABLE_EVENTS`.
 *
 * Idempotência por canal×destinatário via unique do
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
import { DealPartyUpdateEmail } from "@/lib/email/templates/deal-party-update";
import { triggerNewtonDealNotify } from "@/lib/newton/deal-notify-trigger";
import { isNewtonEnabledForDeal } from "@/lib/newton/gate";
import { isWithinWhatsappWindow } from "@/lib/newton/whatsapp-window";
import { appendEvent } from "@/lib/newton/requests";
import { triggerNewtonForRequest } from "@/lib/newton/trigger";
import { normalizeBrPhone } from "@/lib/validators/phone-br";
import { getOrgBrand } from "@/lib/tenant/branding";
import {
  isPartyCapableEvent,
  resolveEffectiveNotificationConfig,
  type DealNotifEvent,
} from "./deal-events-config";
import { resolveDealBrokers, type BrokerRecipient } from "./deal-brokers";
import { resolveDealParties, type PartyRecipient } from "./deal-parties";
import type { DroppedParty } from "@/lib/deals/parties";

/**
 * dedupeKey de stage_change: 1 notificação por (stage destino, dia BRT) —
 * re-drag pro mesmo stage no mesmo dia não re-envia; dia seguinte sim.
 * Dia em America/Sao_Paulo (UTC-3 fixo, Brasil aboliu o DST): bucketing UTC
 * dividiria a noite de trabalho às 21h BRT.
 */
export function stageChangeDedupeKey(stageId: string, when = new Date()): string {
  const brt = new Date(when.getTime() - 3 * 3_600_000);
  const y = brt.getUTCFullYear();
  const m = String(brt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(brt.getUTCDate()).padStart(2, "0");
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
 * null quando já existia (P2002) — caller pula o envio. Nasce "pending" e o
 * caller assenta sent/failed/skipped — assim o histórico não afirma "enviado"
 * se a function morrer entre o claim e o envio real.
 */
async function claimLogRow(params: {
  orgId: string;
  dealId: string;
  event: DealNotifEvent;
  channel: "email" | "whatsapp";
  audience: "broker" | "party";
  recipientKey: string;
  recipientLabel: string | null;
  dedupeKey: string;
}): Promise<string | null> {
  try {
    const row = await prisma.dealNotificationLog.create({
      data: {
        orgId: params.orgId,
        dealId: params.dealId,
        event: params.event,
        channel: params.channel,
        audience: params.audience,
        recipientKey: params.recipientKey,
        recipientLabel: params.recipientLabel,
        dedupeKey: params.dedupeKey,
        status: "pending",
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

/**
 * Textos para a PARTE. Deliberadamente separados de `buildTexts`: aquele fala
 * com quem trabalha o negócio ("o negócio X avançou para o status Y"); este
 * fala com o cliente final, que nunca viu a esteira. Nome do negócio e status
 * não entram — a frase precisa se sustentar sozinha na caixa de entrada dele.
 */
function buildPartyTexts(params: {
  event: DealNotifEvent;
  orgName: string;
  hasLink: boolean;
}): { title: string; body: string; ctaLabel: string | null } {
  const { event, orgName, hasLink } = params;
  if (event === "charge_created") {
    return {
      title: "Cobrança emitida",
      body: hasLink
        ? `A ${orgName} emitiu uma cobrança referente ao seu negócio. Use o link abaixo para ver os detalhes e efetuar o pagamento.`
        : `A ${orgName} emitiu uma cobrança referente ao seu negócio e entrará em contato com as instruções de pagamento.`,
      ctaLabel: hasLink ? "Ver cobrança" : null,
    };
  }
  return {
    title: "Contrato assinado",
    body: `O contrato foi assinado por todas as partes. A ${orgName} segue com os próximos passos e avisa você se precisar de alguma coisa.`,
    ctaLabel: null,
  };
}

/**
 * Link PÚBLICO do evento, se já existir um. Nunca minta um: `mintPublicLink`
 * cria linha no banco, e um aviso não deve materializar página de pagamento que
 * a imobiliária ainda não decidiu compartilhar. Sem link, o e-mail sai sem CTA.
 */
async function resolvePartyPublicUrl(params: {
  event: DealNotifEvent;
  baseUrl: string;
  extra?: Record<string, unknown>;
}): Promise<string | null> {
  const chargeId = params.extra?.chargeId;
  if (params.event !== "charge_created" || typeof chargeId !== "string") {
    return null;
  }
  const link = await prisma.chargePublicLink
    .findUnique({ where: { chargeId }, select: { publicToken: true } })
    .catch(() => null);
  return link ? `${params.baseUrl.replace(/\/$/, "")}/pay/${link.publicToken}` : null;
}

/**
 * Fan-out para as PARTES. Difere do de corretores em dois pontos que não são
 * cosméticos:
 *
 *  - **WhatsApp só via NewtonRequest one-shot** (padrão de
 *    `lib/surveys/channels.ts`), com `triggerNewtonForRequest` — os executores
 *    de locação criam pedido SEM trigger (#193) e o pedido morre no inbox;
 *    escrever pro cliente final não pode depender disso.
 *  - **Gate por tenant**: só imobiliária com Newton habilitado manda WhatsApp
 *    pra parte. Quem usa outro agente fica em e-mail até ele suportar one-shot.
 *
 * Fora da janela 7h–22h o envio vira `skipped` registrado (não existe cron de
 * reconciliação neste motor — melhor um "pulado" visível no histórico do
 * negócio do que uma mensagem de madrugada).
 */
async function notifyParties(params: {
  orgId: string;
  dealId: string;
  dealKind: string;
  dealUserId: string;
  event: DealNotifEvent;
  dedupeKey: string;
  channels: { email: boolean; whatsapp: boolean };
  parties: PartyRecipient[];
  /** Partes fundidas no dedupe por contato repetido — vai pro detail do log. */
  dropped: DroppedParty[];
  publicUrl: string | null;
  orgName: string;
}): Promise<void> {
  const {
    orgId,
    dealId,
    dealKind,
    dealUserId,
    event,
    dedupeKey,
    channels,
    parties,
    dropped,
    publicUrl,
    orgName,
  } = params;

  /**
   * Anexa as partes fundidas ao detail de cada linha de log. O dedupe por
   * contato é agressivo por desenho (duas pessoas que dividem o telefone da
   * família viram uma): sem esse rastro no histórico do negócio, "o comprador
   * não foi avisado" era indistinguível de uma falha de envio.
   */
  const withDropped = (detail: Record<string, unknown>) =>
    dropped.length > 0 ? { ...detail, droppedParties: dropped } : detail;

  const texts = buildPartyTexts({
    event,
    orgName,
    hasLink: Boolean(publicUrl),
  });

  const whatsappAllowed =
    channels.whatsapp &&
    (await isNewtonEnabledForDeal(orgId, dealKind).catch(() => false));
  const withinWindow = isWithinWhatsappWindow();

  for (const party of parties) {
    if (channels.email && party.email) {
      const logId = await claimLogRow({
        orgId,
        dealId,
        event,
        channel: "email",
        audience: "party",
        recipientKey: party.key,
        recipientLabel: party.label,
        dedupeKey,
      });
      if (logId) {
        const result = await sendEmail({
          to: party.email,
          subject: texts.title,
          react: DealPartyUpdateEmail({
            recipientName: party.label,
            eventTitle: texts.title,
            eventBody: texts.body,
            ctaUrl: publicUrl,
            ctaLabel: texts.ctaLabel,
            orgName,
          }),
          orgId,
          tags: [
            { name: "kind", value: "deal-notify-party" },
            { name: "event", value: event },
          ],
        });
        await settleLogRow(
          logId,
          result.ok ? "sent" : "failed",
          withDropped(
            result.ok
              ? { emailId: result.id }
              : { error: result.error ?? "envio recusado" }
          )
        );
      }
    }

    if (!channels.whatsapp || !party.phone) continue;
    const target = normalizeBrPhone(party.phone)?.replace(/^\+/, "") ?? null;
    if (!target) continue;

    const logId = await claimLogRow({
      orgId,
      dealId,
      event,
      channel: "whatsapp",
      audience: "party",
      recipientKey: party.key,
      recipientLabel: party.label,
      dedupeKey,
    });
    if (!logId) continue;

    if (!whatsappAllowed) {
      await settleLogRow(
        logId,
        "skipped",
        withDropped({ reason: "newton_off_para_a_org" })
      );
      continue;
    }
    if (!withinWindow) {
      await settleLogRow(
        logId,
        "skipped",
        withDropped({ reason: "fora_da_janela_7h_22h" })
      );
      continue;
    }

    // dedupeTag ancorado no id da linha de log — a linha já é o chokepoint
    // atômico de idempotência, então a tag herda a garantia de graça.
    const tag = `[deal_party_notify][${logId}]`;
    const firstName =
      party.label.trim().split(/\s+/)[0] || "o cliente";
    const ask =
      `${tag} Aviso do processo: envie UMA única mensagem curta e cordial a ${firstName} ` +
      `informando que ${texts.body}` +
      (publicUrl ? ` Inclua o link ${publicUrl}.` : "") +
      ` Não insista, não re-cobre e não peça informação; marque este pedido como fulfilled imediatamente após enviar.`;

    try {
      let requestId: string;
      try {
        const created = await prisma.newtonRequest.create({
          data: {
            orgId,
            dealId,
            createdBy: dealUserId,
            ask,
            dedupeTag: tag,
            targetType: "contact",
            targetRef: target,
            targetLabel: party.label,
            status: "open",
            priority: "normal",
            eventsJson: appendEvent(null, {
              actor: "sistema",
              type: "deal_party_notify_triggered",
              note: `${event}:${dedupeKey}`,
            }),
          },
          select: { id: true },
        });
        requestId = created.id;
      } catch (e) {
        if ((e as { code?: string })?.code !== "P2002") throw e;
        const existing = await prisma.newtonRequest.findUnique({
          where: { dedupeTag: tag },
          select: { id: true },
        });
        if (!existing) {
          await settleLogRow(logId, "failed", { error: "corrida no dedupe" });
          continue;
        }
        requestId = existing.id;
      }

      await triggerNewtonForRequest({
        orgId,
        dealId,
        requestId,
        ask,
        targetType: "contact",
        targetRef: target,
        targetLabel: party.label,
        kind: "create",
      });
      await settleLogRow(
        logId,
        "sent",
        withDropped({ via: "newton_request", requestId })
      );
    } catch (err) {
      await settleLogRow(
        logId,
        "failed",
        withDropped({ error: err instanceof Error ? err.message : String(err) })
      );
    }
  }
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
        userId: true,
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

    // ── Envios externos (corretores + partes) ───────────────────────────────
    if (config.muted) return;
    const eventCfg = config.events[event];
    const brokerOn = eventCfg.broker.email || eventCfg.broker.whatsapp;
    // A allowlist já foi aplicada no resolver; re-checar aqui é barato e
    // impede que um caller futuro monte a config na mão e escape dela.
    const partyOn =
      isPartyCapableEvent(event) &&
      (eventCfg.party.email || eventCfg.party.whatsapp);
    if (!brokerOn && !partyOn) return;

    const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";

    if (partyOn) {
      const { recipients: parties, dropped } = await resolveDealParties({
        dealId,
        dealKind: deal.pipeline.kind,
        formDataJson: deal.form?.dataJson ?? null,
      });
      if (parties.length > 0) {
        const [brand, publicUrl] = await Promise.all([
          getOrgBrand(orgId).catch(() => null),
          resolvePartyPublicUrl({ event, baseUrl, extra: context?.extra }),
        ]);
        await notifyParties({
          orgId,
          dealId,
          dealKind: deal.pipeline.kind,
          dealUserId: deal.userId,
          event,
          dedupeKey,
          channels: eventCfg.party,
          parties,
          dropped,
          publicUrl,
          orgName: brand?.displayName ?? "imobiliária",
        });
      }
    }

    if (!brokerOn) return;
    const brokers = await resolveDealBrokers({
      orgId,
      formDataJson: deal.form?.dataJson ?? null,
      brokerIds: config.brokerIds,
    });
    if (brokers.length === 0) return;

    for (const broker of brokers) {
      // Email
      if (eventCfg.broker.email && broker.notifyByEmail && broker.email) {
        const logId = await claimLogRow({
          orgId,
          dealId,
          event,
          channel: "email",
          audience: "broker",
          recipientKey: broker.splitRecipientId,
          recipientLabel: broker.label,
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
          if (result.ok) {
            await settleLogRow(logId, "sent", { emailId: result.id });
          } else {
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
          audience: "broker",
          recipientKey: broker.splitRecipientId,
          recipientLabel: broker.label,
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
