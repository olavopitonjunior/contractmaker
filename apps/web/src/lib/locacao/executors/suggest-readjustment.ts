import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { appendEvent } from "@/lib/newton/requests";
import { calculateReadjustment, type Indice } from "@/lib/locacao/readjustment-calculator";

// Newton-executor: suggest_readjustment.
// Disparado D-60 antes de LeaseContract.dataProximoReajuste (via cron).
// Cria NewtonRequest pra operador com simulação do índice + sugestão de aplicar.

export interface SuggestReadjustmentResult {
  ok: boolean;
  requestId?: string;
  reason?: string;
}

export async function suggestReadjustmentExecutor(args: {
  leaseContractId: string;
  orgId: string;
  userId: string;
}): Promise<SuggestReadjustmentResult> {
  const lease = await prisma.leaseContract.findFirst({
    where: { id: args.leaseContractId, orgId: args.orgId },
    include: {
      property: { select: { rua: true, numero: true } },
      tenants: { include: { tenant: { select: { nome: true, phone: true } } } },
    },
  });
  if (!lease) return { ok: false, reason: "LeaseContract não encontrado" };
  if (!lease.dealId) return { ok: false, reason: "LeaseContract sem dealId" };

  // Dedupe: já existe NewtonRequest pra esse contrato com kind suggest_readjustment nos últimos 30d?
  const dedup = await prisma.newtonRequest.findFirst({
    where: {
      orgId: args.orgId,
      dealId: lease.dealId,
      ask: { contains: "[suggest_readjustment]" },
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) },
    },
    select: { id: true },
  });
  if (dedup) return { ok: false, reason: "Já existe sugestão recente (30d)" };

  const calc = calculateReadjustment(
    lease.valorAluguel,
    lease.indiceReajuste as Indice
  );

  const enderecoFmt = lease.property
    ? `${lease.property.rua ?? ""} ${lease.property.numero ?? ""}`.trim()
    : "—";
  const tenantName = lease.tenants[0]?.tenant.nome ?? "inquilino";

  const ask = `[suggest_readjustment] Contrato ${enderecoFmt} (${tenantName}) tem reajuste previsto pra ${lease.dataProximoReajuste?.toLocaleDateString("pt-BR")}. Simulação ${lease.indiceReajuste} (${calc.percentualAplicado.toFixed(2)}%): de R$ ${lease.valorAluguel.toFixed(2)} → R$ ${calc.valorNovo.toFixed(2)}. Confirmar aplicação ou ajustar?`;

  const created = await prisma.newtonRequest.create({
    data: {
      orgId: args.orgId,
      dealId: lease.dealId,
      createdBy: args.userId,
      ask,
      targetType: "contact",
      targetRef: null,
      targetLabel: "operador da imobiliária",
      status: "open",
      priority: "normal",
      eventsJson: appendEvent(null, {
        actor: "sistema",
        type: "suggest_readjustment_triggered",
        note: `leaseContractId=${args.leaseContractId}, percentual=${calc.percentualAplicado}`,
      }),
    },
    select: { id: true },
  });

  await audit(
    { orgId: args.orgId, userId: args.userId },
    {
      action: "NEWTON_REQUEST_CREATE",
      result: "SUCCESS",
      resource: args.leaseContractId,
      resourceType: "LeaseContract",
      metadata: {
        kind: "suggest_readjustment",
        newtonRequestId: created.id,
        percentual: calc.percentualAplicado,
        valorNovo: calc.valorNovo,
      },
    }
  );

  return { ok: true, requestId: created.id };
}
