import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { appendEvent } from "@/lib/newton/requests";

// Newton-executor: detect_late_payment.
// Disparado D+3 após RentCharge.dueDate quando status ainda "pendente".
// Envia lembrete proativo ao inquilino ANTES da régua oficial D+5 (formal).
// Mais leve que dunning normal — só ping informal.

export interface DetectLatePaymentResult {
  ok: boolean;
  requestId?: string;
  reason?: string;
}

export async function detectLatePaymentExecutor(args: {
  rentChargeId: string;
  orgId: string;
  userId: string;
}): Promise<DetectLatePaymentResult> {
  const charge = await prisma.rentCharge.findFirst({
    where: { id: args.rentChargeId, orgId: args.orgId },
    include: {
      leaseContract: {
        include: {
          tenants: { include: { tenant: { select: { nome: true, phone: true } } } },
          property: { select: { rua: true, numero: true } },
        },
      },
    },
  });
  if (!charge) return { ok: false, reason: "RentCharge não encontrado" };
  if (charge.status === "paga" || charge.status === "repassada") {
    return { ok: false, reason: "Cobrança já paga" };
  }
  if (!charge.leaseContract?.dealId) {
    return { ok: false, reason: "LeaseContract sem dealId" };
  }

  // Dedupe por rentCharge nos últimos 7d.
  const dedup = await prisma.newtonRequest.findFirst({
    where: {
      orgId: args.orgId,
      ask: { contains: `[detect_late_payment][${args.rentChargeId}]` },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
    },
    select: { id: true },
  });
  if (dedup) return { ok: false, reason: "Já notificado nos últimos 7d" };

  const titular = charge.leaseContract.tenants.find((t) => t.tipo === "titular")
    ?? charge.leaseContract.tenants[0];
  const tenantName = titular?.tenant.nome ?? "inquilino";
  const tenantPhone = titular?.tenant.phone ?? null;
  const enderecoFmt = charge.leaseContract.property
    ? `${charge.leaseContract.property.rua ?? ""} ${charge.leaseContract.property.numero ?? ""}`.trim()
    : "—";

  const ask = `[detect_late_payment][${args.rentChargeId}] Aluguel de ${enderecoFmt} (${tenantName}) competência ${charge.competencia} venceu há 3 dias e está pendente. Mandar lembrete informal ANTES da régua D+5 formal.`;

  const created = await prisma.newtonRequest.create({
    data: {
      orgId: args.orgId,
      dealId: charge.leaseContract.dealId,
      createdBy: args.userId,
      ask,
      targetType: tenantPhone ? "contact" : "group",
      targetRef: tenantPhone,
      targetLabel: `inquilino ${tenantName}`,
      status: "open",
      priority: "normal",
      eventsJson: appendEvent(null, {
        actor: "sistema",
        type: "detect_late_payment_triggered",
        note: `rentChargeId=${args.rentChargeId}, competencia=${charge.competencia}`,
      }),
    },
    select: { id: true },
  });

  await audit(
    { orgId: args.orgId, userId: args.userId },
    {
      action: "NEWTON_REQUEST_CREATE",
      result: "SUCCESS",
      resource: args.rentChargeId,
      resourceType: "RentCharge",
      metadata: { kind: "detect_late_payment", newtonRequestId: created.id },
    }
  );

  return { ok: true, requestId: created.id };
}
