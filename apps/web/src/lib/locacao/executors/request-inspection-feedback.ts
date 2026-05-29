import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { appendEvent } from "@/lib/newton/requests";

// Newton-executor: request_inspection_feedback.
// Disparado D+1 após Inspection.status="laudo_gerado".
// Pede ao inquilino confirmar/contestar o laudo antes da assinatura.

export interface RequestInspectionFeedbackResult {
  ok: boolean;
  requestId?: string;
  reason?: string;
}

export async function requestInspectionFeedbackExecutor(args: {
  inspectionId: string;
  orgId: string;
  userId: string;
}): Promise<RequestInspectionFeedbackResult> {
  const inspection = await prisma.inspection.findFirst({
    where: { id: args.inspectionId, orgId: args.orgId },
    include: {
      property: { select: { rua: true, numero: true } },
      leaseContract: {
        select: {
          id: true,
          dealId: true,
          tenants: {
            include: { tenant: { select: { nome: true, phone: true } } },
          },
        },
      },
    },
  });
  if (!inspection) return { ok: false, reason: "Inspection não encontrada" };
  if (!inspection.leaseContract?.dealId) {
    return { ok: false, reason: "Inspection sem LeaseContract/Deal" };
  }
  if (inspection.status !== "laudo_gerado") {
    return { ok: false, reason: `Status ${inspection.status} — só dispara em laudo_gerado` };
  }

  const dedup = await prisma.newtonRequest.findFirst({
    where: {
      orgId: args.orgId,
      ask: { contains: `[request_inspection_feedback][${args.inspectionId}]` },
    },
    select: { id: true },
  });
  if (dedup) return { ok: false, reason: "Já solicitado feedback antes" };

  const titular = inspection.leaseContract.tenants.find((t) => t.tipo === "titular")
    ?? inspection.leaseContract.tenants[0];
  const tenantName = titular?.tenant.nome ?? "inquilino";
  const tenantPhone = titular?.tenant.phone ?? null;
  const enderecoFmt = inspection.property
    ? `${inspection.property.rua ?? ""} ${inspection.property.numero ?? ""}`.trim()
    : "—";

  const ask = `[request_inspection_feedback][${args.inspectionId}] Laudo de vistoria (${inspection.tipo}) do imóvel ${enderecoFmt} foi gerado. Pedir confirmação ao inquilino ${tenantName} antes da assinatura ClickSign.${inspection.laudoPdfUrl ? ` Link laudo: ${inspection.laudoPdfUrl}` : ""}`;

  const created = await prisma.newtonRequest.create({
    data: {
      orgId: args.orgId,
      dealId: inspection.leaseContract.dealId,
      createdBy: args.userId,
      ask,
      targetType: tenantPhone ? "contact" : "group",
      targetRef: tenantPhone,
      targetLabel: `inquilino ${tenantName}`,
      status: "open",
      priority: "normal",
      eventsJson: appendEvent(null, {
        actor: "sistema",
        type: "request_inspection_feedback_triggered",
        note: `inspectionId=${args.inspectionId}, tipo=${inspection.tipo}`,
      }),
    },
    select: { id: true },
  });

  await audit(
    { orgId: args.orgId, userId: args.userId },
    {
      action: "NEWTON_REQUEST_CREATE",
      result: "SUCCESS",
      resource: args.inspectionId,
      resourceType: "Inspection",
      metadata: { kind: "request_inspection_feedback", newtonRequestId: created.id },
    }
  );

  return { ok: true, requestId: created.id };
}
