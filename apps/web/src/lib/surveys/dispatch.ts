import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { newSurveyToken } from "./token";
import {
  buildDedupeKey,
  recipientContactKey,
  resolveDealRecipients,
} from "./recipients";
import { sendSurveyInvite } from "./channels";
import { isSurveyFeatureEnabledForKind } from "./guard";
import type { SurveyRecipientRole } from "./types";

/**
 * Motor de disparo automático de pesquisas por mudança de stage.
 *
 * Arquitetura: hook fire-and-forget de 1 linha (`queueSurveyDispatch`) após
 * cada `audit(DEAL_STAGE_CHANGE)` nos call-sites + cron de reconciliação
 * (`/api/cron/surveys/dispatch`) que varre `Deal.stageEnteredAt` recente como
 * rede de segurança. O dedupe atômico (`SurveyInvite.dedupeKey @unique`) torna
 * hook + cron concorrentes inofensivos — reprocessar nunca duplica envio.
 */

/**
 * Hook de call-site: fire-and-forget dentro de waitUntil (em Vercel, `void
 * promise()` seria cancelado no fim da response — memória
 * feedback_vercel_fire_and_forget). Nunca lança nem bloqueia o fluxo.
 */
export function queueSurveyDispatch(dealId: string, stageName?: string): void {
  try {
    waitUntil(
      dispatchSurveysForDeal(dealId, stageName).catch((e) =>
        console.error("[surveys] dispatch falhou", { dealId, error: String(e) })
      )
    );
  } catch {
    // waitUntil indisponível fora da Vercel (ex.: testes) — roda solto.
    void dispatchSurveysForDeal(dealId, stageName).catch((e) =>
      console.error("[surveys] dispatch falhou", { dealId, error: String(e) })
    );
  }
}

export interface DispatchResult {
  matchedAutomations: number;
  created: number;
  skipped: number;
}

/**
 * Dispara as automações que casam com o stage ATUAL do deal (ou `stageName`
 * explícito, vindo do hook — cobre stage transiente que o deal já deixou).
 */
export async function dispatchSurveysForDeal(
  dealId: string,
  stageName?: string
): Promise<DispatchResult> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      kind: true,
      userId: true,
      stage: { select: { name: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return { matchedAutomations: 0, created: 0, skipped: 0 };

  const orgId = deal.pipeline.orgId;
  const dealKind = deal.kind === "locacao" ? "locacao" : "venda";
  const triggerStage = stageName ?? deal.stage?.name;
  if (!triggerStage) return { matchedAutomations: 0, created: 0, skipped: 0 };

  // Feature desligada = automação morta, mesmo com SurveyAutomation rows vivas
  // (super-admin pode desligar a qualquer momento; a UI some, o motor para).
  if (!(await isSurveyFeatureEnabledForKind(orgId, dealKind))) {
    return { matchedAutomations: 0, created: 0, skipped: 0 };
  }

  const automations = await prisma.surveyAutomation.findMany({
    where: { orgId, dealKind, triggerStageName: triggerStage, enabled: true },
  });
  if (automations.length === 0) {
    return { matchedAutomations: 0, created: 0, skipped: 0 };
  }

  const resolved = await resolveDealRecipients(dealId);
  if (!resolved) return { matchedAutomations: automations.length, created: 0, skipped: 0 };

  // Contatos com opt-out anterior na org não recebem disparo automático —
  // por e-mail E por telefone (invite de whatsapp que virou optout).
  const optedOutInvites = await prisma.surveyInvite.findMany({
    where: { orgId, status: "optout" },
    select: { recipientEmail: true, recipientPhone: true },
  });
  const optedOutEmails = new Set(
    optedOutInvites.map((i) => i.recipientEmail).filter((e): e is string => !!e)
  );
  const optedOutPhones = new Set(
    optedOutInvites.map((i) => i.recipientPhone).filter((p): p is string => !!p)
  );

  let created = 0;
  let skipped = 0;

  for (const automation of automations) {
    // Lote = versão-viva da família NO MOMENTO do disparo.
    const template = await prisma.surveyTemplate.findFirst({
      where: {
        orgId,
        familyId: automation.templateFamilyId,
        isLatest: true,
        status: "active",
      },
      select: { id: true, name: true },
    });
    if (!template) {
      skipped++;
      continue;
    }

    const audience = new Set(automation.audience as SurveyRecipientRole[]);
    const targets = resolved.recipients.filter((r) => audience.has(r.role));

    for (const target of targets) {
      const contact = recipientContactKey(target);
      if (!contact) {
        skipped++;
        continue;
      }
      // Email estrito exige email; whatsapp tem fallback pra email, então
      // basta UM contato viável (telefone ou email).
      if (automation.channel === "email" && !target.email) {
        skipped++;
        continue;
      }
      if (automation.channel === "whatsapp" && !target.phone && !target.email) {
        skipped++;
        continue;
      }
      if (
        (target.email && optedOutEmails.has(target.email)) ||
        (target.phone && optedOutPhones.has(target.phone))
      ) {
        skipped++;
        continue;
      }

      const dedupeKey = buildDedupeKey({
        dealId,
        templateId: template.id,
        role: target.role,
        contact,
      });
      const { token, exp } = newSurveyToken();

      let invite;
      try {
        invite = await prisma.surveyInvite.create({
          data: {
            orgId,
            templateId: template.id,
            automationId: automation.id,
            dealId,
            recipientRole: target.role,
            recipientName: target.name,
            recipientEmail: target.email,
            recipientPhone: target.phone,
            channel: automation.channel,
            token,
            tokenExp: exp,
            dedupeKey,
          },
        });
      } catch (e) {
        if ((e as { code?: string })?.code === "P2002") {
          skipped++; // já disparado pra este destinatário neste lote/deal
          continue;
        }
        throw e;
      }

      created++;
      void audit(
        { orgId, userId: null },
        {
          action: "SURVEY_INVITE_CREATED",
          result: "SUCCESS",
          resource: invite.id,
          resourceType: "SurveyInvite",
          metadata: {
            automationId: automation.id,
            templateId: template.id,
            dealId,
            stage: triggerStage,
            role: target.role,
            channel: automation.channel,
          },
        }
      );

      const sent = await sendSurveyInvite({
        invite,
        templateName: template.name,
        orgId,
        deal: { id: deal.id, kind: dealKind, userId: deal.userId },
      });
      if (sent.ok) {
        void audit(
          { orgId, userId: null },
          {
            action: "SURVEY_INVITE_SENT",
            result: "SUCCESS",
            resource: invite.id,
            resourceType: "SurveyInvite",
            metadata: { channel: invite.channel, automationId: automation.id },
          }
        );
      }
    }
  }

  return { matchedAutomations: automations.length, created, skipped };
}
