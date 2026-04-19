/**
 * Emite Notification no DB para eventos do módulo Pagadoria.
 * Integrado ao sino existente em NotificationsBell.tsx.
 *
 * Fire-and-forget — falhas são logadas mas nunca propagam ao caller.
 */

import { prisma } from "@/lib/db/prisma";

export type PagadoriaNotifType =
  | "dual_approval_pending"
  | "dual_approval_resolved"
  | "charge_overdue"
  | "transfer_done"
  | "transfer_failed";

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
