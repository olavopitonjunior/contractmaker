/**
 * Emite Notification no DB para eventos do módulo Pagadoria.
 * Integrado ao sino existente em NotificationsBell.tsx.
 *
 * Fire-and-forget — falhas são logadas mas nunca propagam ao caller.
 */

import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import {
  ChargeCreatedEmail,
  ChargePaidOwnerEmail,
  ChargePaidRecipientEmail,
  ChargeOverdueEmail,
  ChargeDueSoonEmail,
} from "@/lib/email/templates/charge-events";

export type PagadoriaNotifType =
  | "dual_approval_pending"
  | "dual_approval_resolved"
  | "charge_overdue"
  | "transfer_done"
  | "transfer_failed"
  | "charge_created"
  | "charge_paid"
  | "charge_due_soon"
  | "charge_cancelled"
  | "charge_refunded";

interface NotifInput {
  orgId: string;
  userId?: string | null;
  type: PagadoriaNotifType;
  title: string;
  body: string;
  linkUrl?: string | null;
  batchId: string; // obrigatório para @@unique([type, batchId]) dedup
  metadata?: Record<string, unknown>;
}

export async function emitPagadoriaNotif(input: NotifInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        orgId: input.orgId,
        userId: input.userId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        linkUrl: input.linkUrl ?? null,
        batchId: input.batchId,
        metadata: (input.metadata ?? null) as any,
      },
    });
  } catch (err: any) {
    // P2002 = unique violation (já existe) — ignora
    if (err?.code === "P2002") return;
    console.error("[emitPagadoriaNotif] falhou:", err);
  }
}

/**
 * Cria notif separada para cada admin que pode aprovar.
 * O iniciador NÃO é notificado aqui (ele já sabe — veio da UI).
 */
export async function emitDualApprovalNotifs(params: {
  approvalId: string;
  orgId: string;
  initiatorUserId: string;
  kind: string;
  amount: number | null;
  initiatorName: string;
}): Promise<number> {
  const admins = await prisma.orgMembership.findMany({
    where: {
      orgId: params.orgId,
      role: { in: ["owner", "admin"] },
      userId: { not: params.initiatorUserId },
    },
    select: { userId: true },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const linkUrl = `${baseUrl}/financeiro/dual-approvals/${params.approvalId}`;
  const amountStr = params.amount
    ? params.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "";

  const kindLabels: Record<string, string> = {
    TRANSFER: "Transferência",
    REFUND_LARGE: "Estorno",
    SPLIT_CHANGE: "Alteração de split",
    FEES_CHANGE: "Alteração de taxas",
  };
  const kindLabel = kindLabels[params.kind] ?? params.kind;

  await Promise.all(
    admins.map((a) =>
      emitPagadoriaNotif({
        orgId: params.orgId,
        userId: a.userId,
        type: "dual_approval_pending",
        title: `${kindLabel} aguardando sua aprovação`,
        body: `${params.initiatorName} iniciou ${kindLabel.toLowerCase()}${
          amountStr ? ` de ${amountStr}` : ""
        }.`,
        linkUrl,
        batchId: `approval-${params.approvalId}-${a.userId}`,
        metadata: {
          approvalId: params.approvalId,
          kind: params.kind,
          amount: params.amount,
        },
      })
    )
  );
  return admins.length;
}

/**
 * Notif para iniciador quando dual approval é resolvido.
 */
export async function emitDualApprovalResolvedNotif(params: {
  approvalId: string;
  orgId: string;
  initiatorUserId: string;
  approverName: string;
  kind: string;
  resolution: "APPROVED" | "REJECTED";
  note?: string | null;
}): Promise<void> {
  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const linkUrl = `${baseUrl}/financeiro/dual-approvals/${params.approvalId}`;
  const approved = params.resolution === "APPROVED";
  const kindLabels: Record<string, string> = {
    TRANSFER: "Transferência",
    REFUND_LARGE: "Estorno",
    SPLIT_CHANGE: "Alteração de split",
    FEES_CHANGE: "Alteração de taxas",
  };
  const kindLabel = kindLabels[params.kind] ?? params.kind;

  await emitPagadoriaNotif({
    orgId: params.orgId,
    userId: params.initiatorUserId,
    type: "dual_approval_resolved",
    title: `Sua ${kindLabel.toLowerCase()} foi ${approved ? "aprovada" : "rejeitada"}`,
    body: `${params.approverName} ${approved ? "aprovou" : "rejeitou"}${
      params.note ? `: ${params.note}` : ""
    }`,
    linkUrl,
    batchId: `approval-resolved-${params.approvalId}`,
    metadata: {
      approvalId: params.approvalId,
      resolution: params.resolution,
    },
  });
}

// ============================================================
// Régua interna de cobranças (Pagadoria 2026-05-09)
// ============================================================

export type ChargeEvent =
  | "created"
  | "paid"
  | "overdue"
  | "due_soon"
  | "cancelled"
  | "refunded";

const EVENT_TO_NOTIF_TYPE: Record<ChargeEvent, PagadoriaNotifType> = {
  created: "charge_created",
  paid: "charge_paid",
  overdue: "charge_overdue",
  due_soon: "charge_due_soon",
  cancelled: "charge_cancelled",
  refunded: "charge_refunded",
};

const EVENT_LABELS: Record<ChargeEvent, string> = {
  created: "criada",
  paid: "paga",
  overdue: "vencida",
  due_soon: "vencendo em 3 dias",
  cancelled: "cancelada",
  refunded: "estornada",
};

interface SplitJsonShape {
  splits?: Array<{ walletId: string; percentualValue?: number; fixedValue?: number }>;
  external?: Array<{
    recipientId: string;
    pixAddressKey: string;
    ownerName: string;
    percentualValue?: number;
    fixedValue?: number;
  }>;
  display?: { hiddenRecipientIds?: string[]; consolidationMap?: Record<string, string> };
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

/**
 * Disparo central da régua de notificações por evento de cobrança.
 *
 * Fan-out:
 *   - Owner do deal (via `deal.userId`): bell + email se setting habilitado
 *   - Admins (`OrgMembership.role in [owner, admin]`): só `paid` se opt-in
 *   - Comissionados visíveis com `SplitRecipient.email`: só `paid` se opt-in
 *
 * Idempotente via `Notification.@@unique([type, batchId])` — mesmo evento
 * disparado 2x gera no máximo 1 notif por usuário.
 */
export async function notifyChargeEvent(params: {
  chargeId: string;
  event: ChargeEvent;
  orgId: string;
}): Promise<void> {
  const { chargeId, event, orgId } = params;
  try {
    const charge = await prisma.commissionCharge.findFirst({
      where: { id: chargeId, orgId },
      include: {
        deal: { select: { id: true, title: true, userId: true } },
        customer: { select: { name: true, email: true } },
      },
    });
    if (!charge) return;

    // Per-account: resolve via charge.accountId; fallback pra primeira conta.
    const settings = charge.accountId
      ? (await prisma.orgFinancialSettings.findUnique({
          where: { accountId: charge.accountId },
        })) ??
        (await prisma.orgFinancialSettings.findFirst({
          where: { orgId },
          orderBy: { createdAt: "asc" },
        }))
      : await prisma.orgFinancialSettings.findFirst({
          where: { orgId },
          orderBy: { createdAt: "asc" },
        });

    const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
    const linkUrl = `${baseUrl}/financeiro/cobrancas/${charge.id}`;
    const valueStr = fmtBRL(charge.value);
    const dealTitle = charge.deal?.title ?? null;
    const customerName = charge.customer?.name ?? "Cliente";
    const eventLabel = EVENT_LABELS[event];
    const notifType = EVENT_TO_NOTIF_TYPE[event];

    // ---- 1) Owner do deal ----
    const ownerSettingByEvent: Record<ChargeEvent, boolean> = {
      created: settings?.notifyOwnerOnCreated ?? true,
      paid: settings?.notifyOwnerOnPaid ?? true,
      overdue: settings?.notifyOwnerOnOverdue ?? true,
      due_soon: settings?.notifyOwnerOnDueSoon ?? true,
      cancelled: true, // sempre notifica cancelamento
      refunded: true, // sempre notifica estorno
    };
    const ownerOpt = ownerSettingByEvent[event];

    if (charge.deal?.userId && ownerOpt) {
      const dateStr =
        event === "due_soon"
          ? `-${fmtDate(charge.currentDueDate)}`
          : "";
      const batchId = `charge-${event}-${charge.id}-owner${dateStr}`;
      await emitPagadoriaNotif({
        orgId,
        userId: charge.deal.userId,
        type: notifType,
        title: `Cobrança ${eventLabel}${dealTitle ? ` — ${dealTitle}` : ""}`,
        body: `${customerName} • ${valueStr}`,
        linkUrl,
        batchId,
        metadata: { chargeId: charge.id, dealId: charge.deal.id, event },
      });

      const owner = await prisma.user.findUnique({
        where: { id: charge.deal.userId },
        select: { email: true, name: true },
      });
      if (owner?.email) {
        const tpl = pickOwnerEmail(event, {
          ownerName: owner.name ?? "",
          chargeId: charge.id,
          customerName,
          valueStr,
          dueDateStr: fmtDate(charge.currentDueDate),
          dealTitle,
          linkUrl,
        });
        if (tpl) {
          await sendEmail({
            to: owner.email,
            subject: tpl.subject,
            react: tpl.react,
            tags: [
              { name: "kind", value: "pagadoria" },
              { name: "event", value: notifType },
            ],
          });
        }
      }
    }

    // ---- 2) Admins (apenas event=paid se opt-in) ----
    if (event === "paid" && settings?.notifyAdminsOnPaid) {
      const admins = await prisma.orgMembership.findMany({
        where: {
          orgId,
          role: { in: ["owner", "admin"] },
          userId: { not: charge.deal?.userId ?? "__none__" },
        },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      });
      for (const a of admins) {
        if (!a.user.email) continue;
        await sendEmail({
          to: a.user.email,
          subject: `[Admin] Cobrança paga — ${customerName} • ${valueStr}`,
          react: ChargePaidOwnerEmail({
            ownerName: a.user.name ?? "",
            customerName,
            valueStr,
            dueDateStr: fmtDate(charge.currentDueDate),
            dealTitle,
            linkUrl,
          }),
          tags: [
            { name: "kind", value: "pagadoria" },
            { name: "event", value: "charge_paid_admin" },
          ],
        });
      }
    }

    // ---- 3) Comissionados (apenas event=paid se opt-in) ----
    if (event === "paid" && (settings?.notifyComissionados ?? true)) {
      const splitJson = (charge.splitJson ?? null) as SplitJsonShape | null;
      const hiddenIds = new Set(splitJson?.display?.hiddenRecipientIds ?? []);
      const recipientIds: string[] = [];
      for (const e of splitJson?.external ?? []) {
        if (!hiddenIds.has(e.recipientId)) recipientIds.push(e.recipientId);
      }
      // wallet splits: recipientId é opcional no schema antigo; tentamos lookup por walletId
      const walletIds: string[] = [];
      for (const s of splitJson?.splits ?? []) {
        if (!hiddenIds.has(s.walletId)) walletIds.push(s.walletId);
      }
      const recipients = await prisma.splitRecipient.findMany({
        where: {
          orgId,
          OR: [
            { id: { in: recipientIds } },
            { walletId: { in: walletIds } },
          ],
          email: { not: null },
          active: true,
        },
      });
      for (const r of recipients) {
        if (!r.email) continue;
        // Calcula valor estimado pra esta linha
        let estimatedValue = 0;
        const ext = (splitJson?.external ?? []).find((e) => e.recipientId === r.id);
        const wal = (splitJson?.splits ?? []).find((s) => s.walletId === r.walletId);
        const matched = ext ?? wal;
        if (matched) {
          estimatedValue = matched.percentualValue
            ? Math.round((charge.value * matched.percentualValue) / 100 * 100) / 100
            : matched.fixedValue ?? 0;
        }
        await sendEmail({
          to: r.email,
          subject: `Você recebeu ${fmtBRL(estimatedValue)} de ${customerName}`,
          react: ChargePaidRecipientEmail({
            recipientName: r.label,
            customerName,
            valueStr: fmtBRL(estimatedValue),
            grossStr: valueStr,
            dealTitle,
            recipientType: r.recipientType,
          }),
          tags: [
            { name: "kind", value: "pagadoria" },
            { name: "event", value: "charge_paid_recipient" },
          ],
        });
      }
    }
  } catch (err) {
    console.error("[notifyChargeEvent] falhou:", err);
  }
}

function pickOwnerEmail(
  event: ChargeEvent,
  data: {
    ownerName: string;
    chargeId: string;
    customerName: string;
    valueStr: string;
    dueDateStr: string;
    dealTitle: string | null;
    linkUrl: string;
  }
): { subject: string; react: React.ReactElement } | null {
  const { customerName, valueStr, dueDateStr, dealTitle } = data;
  switch (event) {
    case "created":
      return {
        subject: `Cobrança criada — ${customerName} • ${valueStr}`,
        react: ChargeCreatedEmail({ ...data }),
      };
    case "paid":
      return {
        subject: `Cobrança paga — ${customerName} • ${valueStr}`,
        react: ChargePaidOwnerEmail({ ...data }),
      };
    case "overdue":
      return {
        subject: `Cobrança vencida — ${customerName} • ${valueStr}`,
        react: ChargeOverdueEmail({ ...data }),
      };
    case "due_soon":
      return {
        subject: `Cobrança vence em 3 dias — ${customerName} • ${valueStr}`,
        react: ChargeDueSoonEmail({ ...data }),
      };
    case "cancelled":
    case "refunded":
      return null; // só sino, sem email
  }
}
