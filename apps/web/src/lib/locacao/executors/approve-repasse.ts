import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { appendEvent } from "@/lib/newton/requests";

// Newton-executor: approve_repasse.
// Disparado quando AsaasTransfer estoura `dualApprovalCapCents` (HITL).
// Cria NewtonRequest pro operador aprovar/rejeitar pelo WhatsApp.
// O Newton agente externo recebe e oferece botões de aprovação.

export interface ApproveRepasseResult {
  ok: boolean;
  requestId?: string;
  reason?: string;
}

export async function approveRepasseExecutor(args: {
  transferId: string;
  orgId: string;
  userId: string;
}): Promise<ApproveRepasseResult> {
  const transfer = await prisma.asaasTransfer.findFirst({
    where: { id: args.transferId, orgId: args.orgId },
  });
  if (!transfer) return { ok: false, reason: "AsaasTransfer não encontrado" };

  // Tenta achar Deal correlato via RentCharge.repasseTransferId.
  const rentCharge = await prisma.rentCharge.findFirst({
    where: { repasseTransferId: args.transferId, orgId: args.orgId },
    include: {
      leaseContract: { select: { dealId: true } },
    },
  });
  const dealId = rentCharge?.leaseContract?.dealId ?? null;
  if (!dealId) {
    return {
      ok: false,
      reason: "Transfer sem RentCharge/Deal correlato — operador deve aprovar direto na UI /financeiro/dual-approvals",
    };
  }

  const dedup = await prisma.newtonRequest.findFirst({
    where: {
      orgId: args.orgId,
      ask: { contains: `[approve_repasse][${args.transferId}]` },
    },
    select: { id: true },
  });
  if (dedup) return { ok: false, reason: "Já solicitada aprovação antes" };

  const ask = `[approve_repasse][${args.transferId}] Repasse de R$ ${transfer.value.toFixed(2)} pra ${transfer.ownerName ?? "proprietário"} (${transfer.pixAddressKey ?? "—"}) excede o cap de aprovação dupla. Confirmar?`;

  const created = await prisma.newtonRequest.create({
    data: {
      orgId: args.orgId,
      dealId,
      createdBy: args.userId,
      ask,
      targetType: "contact",
      targetRef: null,
      targetLabel: "operador da imobiliária",
      status: "open",
      priority: "high",
      eventsJson: appendEvent(null, {
        actor: "sistema",
        type: "approve_repasse_triggered",
        note: `transferId=${args.transferId}, value=${transfer.value}`,
      }),
    },
    select: { id: true },
  });

  await audit(
    { orgId: args.orgId, userId: args.userId },
    {
      action: "NEWTON_REQUEST_CREATE",
      result: "SUCCESS",
      resource: args.transferId,
      resourceType: "AsaasTransfer",
      metadata: { kind: "approve_repasse", newtonRequestId: created.id, value: transfer.value },
    }
  );

  return { ok: true, requestId: created.id };
}
