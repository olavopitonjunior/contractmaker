import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { inspectionCreateSchema } from "@/lib/locacao/validators";

// Intent-executor: INSPECTION_SCHEDULE
// Newton (WhatsApp) negociou janela com inquilino e vistoriador. HITL quando
// detectou conflito de agenda (mesma janela, mesmo vistoriador). Quando
// aprovado, executor cria a Inspection com status="em_campo".
//
// docs/locacao/spec.md §11c.

export interface RunScheduleInspectionArgs {
  payload: Record<string, unknown>;
  orgId: string;
  userId: string;
}

export interface RunResult<T = unknown> {
  status: number;
  body: T;
}

const WINDOW_MINUTES = 90;

export async function runScheduleInspectionFromIntent(
  args: RunScheduleInspectionArgs
): Promise<RunResult> {
  const parsed = inspectionCreateSchema.safeParse(args.payload);
  if (!parsed.success) {
    return {
      status: 422,
      body: { error: "Payload inválido", details: parsed.error.flatten() },
    };
  }
  const data = parsed.data;

  const property = await prisma.property.findFirst({
    where: { id: data.propertyId, orgId: args.orgId },
    select: { id: true },
  });
  if (!property) {
    return { status: 422, body: { error: "Imóvel não pertence à org." } };
  }

  // Detecta conflito de agenda do vistoriador (janela de 90min). Se houver,
  // não bloqueia (o HITL já foi aceito) — mas registra como warning no audit.
  let conflitos: Array<{ id: string }> = [];
  if (data.scheduledFor && data.executorId) {
    const windowStart = new Date(data.scheduledFor.getTime() - WINDOW_MINUTES * 60_000);
    const windowEnd = new Date(data.scheduledFor.getTime() + WINDOW_MINUTES * 60_000);
    conflitos = await prisma.inspection.findMany({
      where: {
        orgId: args.orgId,
        executorId: data.executorId,
        status: { in: ["em_campo", "rascunho"] },
        updatedAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true },
    });
  }

  const inspection = await prisma.inspection.create({
    data: {
      orgId: args.orgId,
      propertyId: data.propertyId,
      leaseContractId: data.leaseContractId ?? null,
      tipo: data.tipo,
      tipoImovel: data.tipoImovel ?? null,
      executorId: data.executorId ?? null,
      status: data.scheduledFor ? "em_campo" : "rascunho",
    },
  });

  await audit(
    { orgId: args.orgId, userId: args.userId },
    {
      action: "INSPECTION_SCHEDULE",
      result: "SUCCESS",
      resource: inspection.id,
      resourceType: "Inspection",
      metadata: {
        scheduledFor: data.scheduledFor?.toISOString(),
        executorId: data.executorId,
        conflicts: conflitos.length,
        source: "newton_intent",
      },
    }
  );

  return { status: 201, body: { inspection, conflicts: conflitos.length } };
}
