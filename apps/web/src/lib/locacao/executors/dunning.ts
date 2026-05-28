import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { appendEvent } from "@/lib/newton/requests";

// Newton-executor: cobrar aluguel atrasado (régua).
// Sem HITL — régua é automática. Cria um NewtonRequest tipado por janela
// (D-3, D+1, D+5, D+30, D+60) que o agente WhatsApp pega e dispara.
// docs/locacao/spec.md §6.2 + §11c.

export type DunningStage =
  | "lembrete_d_minus_3"
  | "atraso_d_plus_1"
  | "formal_d_plus_5"
  | "extrajudicial_d_plus_30"
  | "garantia_d_plus_60";

export interface DunningResult {
  ok: boolean;
  requestId?: string;
  reason?: string;
}

const STAGE_DESCRIPTIONS: Record<DunningStage, string> = {
  lembrete_d_minus_3: "Lembrete amigável — vencimento em 3 dias",
  atraso_d_plus_1: "Aluguel em atraso há 1 dia — primeira cobrança",
  formal_d_plus_5: "Aluguel em atraso há 5 dias — cobrança formal",
  extrajudicial_d_plus_30: "Aluguel em atraso há 30 dias — aviso pré-judicial",
  garantia_d_plus_60: "Aluguel em atraso há 60 dias — acionar garantia",
};

/**
 * Dispara um lembrete/régua de cobrança para um RentCharge específico.
 * Newton (WhatsApp) recebe o NewtonRequest correspondente.
 *
 * Escopo: o caller (endpoint) já validou PERMISSION.RENT_REMIND.
 */
export async function dunningExecutor(args: {
  rentChargeId: string;
  orgId: string;
  userId: string; // negociadora que disparou
  stage?: DunningStage; // auto-deduz se não passado
}): Promise<DunningResult> {
  const charge = await prisma.rentCharge.findFirst({
    where: { id: args.rentChargeId, orgId: args.orgId },
    include: {
      leaseContract: {
        include: {
          tenants: { include: { tenant: { select: { id: true, nome: true, phone: true } } } },
          property: { select: { rua: true, numero: true } },
        },
      },
    },
  });
  if (!charge) {
    return { ok: false, reason: "RentCharge não encontrado" };
  }

  // Auto-stage por atraso (dueDate vs hoje).
  const now = new Date();
  const diasDeAtraso = Math.floor((now.getTime() - charge.dueDate.getTime()) / (24 * 60 * 60 * 1000));
  let stage: DunningStage;
  if (args.stage) {
    stage = args.stage;
  } else if (diasDeAtraso < -1) {
    stage = "lembrete_d_minus_3";
  } else if (diasDeAtraso <= 4) {
    stage = "atraso_d_plus_1";
  } else if (diasDeAtraso <= 29) {
    stage = "formal_d_plus_5";
  } else if (diasDeAtraso <= 59) {
    stage = "extrajudicial_d_plus_30";
  } else {
    stage = "garantia_d_plus_60";
  }

  // Encontra um Deal vinculado ao LeaseContract pra ancorar o NewtonRequest
  // (NewtonRequest hoje é ancorado em Deal). Se não houver, abortamos —
  // arquitetura de NewtonRequest dedicado a LeaseContract fica como F2.
  const lease = charge.leaseContract;
  if (!lease) {
    return { ok: false, reason: "LeaseContract órfão" };
  }

  const titular = lease.tenants.find((t) => t.tipo === "titular") ?? lease.tenants[0];
  const tenantName = titular?.tenant.nome ?? "locatário";
  const tenantPhone = titular?.tenant.phone ?? null;
  const enderecoFmt = lease.property
    ? `${lease.property.rua ?? ""} ${lease.property.numero ?? ""}`.trim()
    : "—";

  // Localiza Deal de locação vinculado ao LeaseContract (via campo dealId scalar).
  const leaseDealId = lease.dealId;
  if (!leaseDealId) {
    return { ok: false, reason: "LeaseContract não tem dealId — régua precisa de Deal pra ancorar." };
  }
  const deal = await prisma.deal.findFirst({
    where: { id: leaseDealId, pipeline: { orgId: args.orgId } },
    select: { id: true },
  });
  if (!deal) {
    return { ok: false, reason: "Deal vinculado não encontrado." };
  }

  const ask = `${STAGE_DESCRIPTIONS[stage]}. Contrato locação ${enderecoFmt}. Cobrança ${charge.competencia} — R$ ${charge.valorBase.toFixed(2)}. Pedir comprovante de pagamento ou negociação.`;

  const created = await prisma.newtonRequest.create({
    data: {
      orgId: args.orgId,
      dealId: deal.id,
      createdBy: args.userId,
      ask,
      targetType: tenantPhone ? "contact" : "group",
      targetRef: tenantPhone ?? null,
      targetLabel: `inquilino ${tenantName}`,
      status: "open",
      priority: stage === "extrajudicial_d_plus_30" || stage === "garantia_d_plus_60" ? "high" : "normal",
      eventsJson: appendEvent(null, {
        actor: "sistema",
        type: "dunning_stage_triggered",
        note: `stage=${stage}, rentChargeId=${args.rentChargeId}`,
      }),
    },
    select: { id: true },
  });

  await audit(
    { orgId: args.orgId, userId: args.userId },
    {
      action: "RENT_REMIND",
      result: "SUCCESS",
      resource: args.rentChargeId,
      resourceType: "RentCharge",
      metadata: { stage, newtonRequestId: created.id, diasDeAtraso },
    }
  );

  return { ok: true, requestId: created.id };
}
