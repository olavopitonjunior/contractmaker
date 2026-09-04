/**
 * E-mail aos CORRETORES PARCEIROS de uma proposta nos marcos que interessam a
 * quem acompanha de fora: encaminhada (`sent`), assinada pelo proponente
 * (`signed_proponente`) e completa (`completed`).
 *
 * Trilho PRÓPRIO, separado do sino do dono (`notifyProposalMilestone`) e do
 * sweep de canais de usuário: o parceiro tipicamente NÃO é usuário da
 * plataforma — é um `SplitRecipient` do registry, e é lá que moram as
 * preferências dele (`notifyByEmail`, `notifyOptOut`). Quem decide se ele
 * recebe é o registry, nunca o `dataJson` da proposta.
 *
 * Resolução de destinatários = a MESMA de `resolveDealBrokers` (casa as linhas
 * de `comissao.comissionados[]`/`angariadores[]` com o registry por id, doc ou
 * nome). Uma regra só nas duas superfícies: quem recebe e-mail da proposta é
 * exatamente quem vai receber do negócio depois da conversão.
 *
 * Dedupe: `ProposalNotificationLog` unique (proposta, marco, canal,
 * destinatário), insert-first. `completed` dispara de cinco call-sites; o
 * segundo insert cai em P2002 e o e-mail não sai duas vezes.
 *
 * Nunca lança — falha aqui não pode derrubar webhook/envio.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import { ProposalUpdateEmail } from "@/lib/email/templates/proposal-update";
import { resolveDealBrokers } from "@/lib/notifications/deal-brokers";
import { summarizeProposalData } from "./summarize";

export type PartnerBrokerNotifKind = "sent" | "signed_proponente" | "completed";

export const PARTNER_BROKER_KINDS: ReadonlySet<string> = new Set<PartnerBrokerNotifKind>([
  "sent",
  "signed_proponente",
  "completed",
]);

export function isPartnerBrokerKind(kind: string): kind is PartnerBrokerNotifKind {
  return PARTNER_BROKER_KINDS.has(kind);
}

const TEXT: Record<PartnerBrokerNotifKind, { title: string; body: string }> = {
  sent: {
    title: "Proposta encaminhada para assinatura",
    body: "A proposta foi encaminhada ao proponente para assinatura. Você será avisado(a) quando ela for assinada.",
  },
  signed_proponente: {
    title: "Proponente assinou a proposta",
    body: "O proponente assinou a proposta. Ela segue agora para a outra parte.",
  },
  completed: {
    title: "Proposta assinada por todos",
    body: "A proposta foi aceita e assinada por todas as partes. A imobiliária dará continuidade ao negócio.",
  },
};

export interface PartnerBrokerNotifyResult {
  sent: number;
  skipped: number;
  failed: number;
}

async function claimLogRow(params: {
  orgId: string;
  proposalId: string;
  kind: PartnerBrokerNotifKind;
  recipientKey: string;
  recipientLabel: string | null;
}): Promise<string | null> {
  try {
    const row = await prisma.proposalNotificationLog.create({
      data: {
        orgId: params.orgId,
        proposalId: params.proposalId,
        kind: params.kind,
        channel: "email",
        recipientKey: params.recipientKey,
        recipientLabel: params.recipientLabel,
        status: "pending",
      },
    });
    return row.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return null;
    }
    throw err;
  }
}

async function settleLogRow(
  logId: string,
  status: "sent" | "failed",
  detail?: Record<string, unknown>
): Promise<void> {
  await prisma.proposalNotificationLog
    .update({
      where: { id: logId },
      data: { status, detail: detail ? (detail as Prisma.InputJsonObject) : undefined },
    })
    .catch(() => {});
}

export async function notifyProposalPartnerBrokers(params: {
  proposalId: string;
  orgId: string;
  kind: PartnerBrokerNotifKind;
}): Promise<PartnerBrokerNotifyResult> {
  const { proposalId, orgId, kind } = params;
  const out: PartnerBrokerNotifyResult = { sent: 0, skipped: 0, failed: 0 };
  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, orgId: true, code: true, title: true, kind: true, dataJson: true },
    });
    if (!proposal || proposal.orgId !== orgId) return out;

    const brokers = await resolveDealBrokers({
      orgId,
      formDataJson: proposal.dataJson,
      brokerIds: [],
    });
    if (brokers.length === 0) return out;

    const texts = TEXT[kind];
    const resumo = summarizeProposalData(proposal.dataJson, proposal.kind);

    for (const broker of brokers) {
      if (!broker.notifyByEmail || !broker.email) {
        out.skipped++;
        continue;
      }
      const logId = await claimLogRow({
        orgId,
        proposalId,
        kind,
        recipientKey: broker.splitRecipientId,
        recipientLabel: broker.label,
      });
      if (!logId) {
        out.skipped++;
        continue;
      }
      const result = await sendEmail({
        to: broker.email,
        subject: `${texts.title} — ${proposal.code ?? proposal.title}`,
        react: ProposalUpdateEmail({
          recipientName: broker.label,
          eventTitle: texts.title,
          eventBody: texts.body,
          proposalCode: proposal.code,
          proposalTitle: proposal.title,
          resumo: {
            proponente: resumo.proponente,
            imovel: resumo.imovel,
            valorLabel: resumo.valorLabel,
          },
        }),
        orgId,
        tags: [
          { name: "kind", value: "proposal-partner" },
          { name: "event", value: kind },
        ],
      });
      if (result.ok) {
        out.sent++;
        await settleLogRow(logId, "sent", { emailId: result.id });
      } else {
        out.failed++;
        await settleLogRow(logId, "failed", { error: result.error ?? "envio recusado" });
      }
    }
  } catch (err) {
    console.error("[proposals/notify-partner-brokers] falha", { proposalId, kind }, err);
  }
  return out;
}
