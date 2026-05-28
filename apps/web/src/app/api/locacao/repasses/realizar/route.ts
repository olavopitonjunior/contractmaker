import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";

export const dynamic = "force-dynamic";

const realizarRepasseSchema = z.object({
  rentChargeIds: z.array(z.string().min(1)).min(1),
  agrupado: z.boolean().default(false),
});

/**
 * POST /api/locacao/repasses/realizar
 *
 * Marca as RentCharges como `repassada` e cria os AsaasTransfer correspondentes
 * (status PENDING_DISPATCH — quem realmente dispara é o splitDispatcher / cron
 * de transferência). Modo `agrupado` consolida várias cobranças num único
 * AsaasTransfer por proprietário.
 *
 * Fase 1: gravamos apenas a marcação interna + reserva do AsaasTransfer. O
 * dispatch real pra Asaas é o passo seguinte (depende de wallet/PIX do
 * proprietário cadastrado em PropertyOwner).
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.RENT_MARK_REPASSED);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, realizarRepasseSchema);
  if (!parsed.ok) return parsed.response;

  // Carrega as cobranças com cross-org guard.
  const charges = await prisma.rentCharge.findMany({
    where: {
      id: { in: parsed.data.rentChargeIds },
      orgId: ctx.orgId,
      status: "paga",
      repasseTransferId: null,
    },
    include: {
      leaseContract: {
        include: {
          property: {
            include: {
              ownerships: { include: { owner: true } },
            },
          },
        },
      },
    },
  });
  if (charges.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma cobrança válida (pagas e sem repasse) encontrada." },
      { status: 422 }
    );
  }

  // Resolve a conta Asaas ativa da org (origem da transferência).
  const orgAsaasAccount = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { activeAsaasAccountId: true },
  });
  const accountId = orgAsaasAccount?.activeAsaasAccountId ?? null;

  let createdTransfers = 0;
  let updatedCharges = 0;

  await prisma.$transaction(async (tx) => {
    for (const rc of charges) {
      const principal =
        rc.leaseContract?.property?.ownerships.find((o) => o.tipo === "proprietario_principal") ??
        rc.leaseContract?.property?.ownerships[0];
      // Calcula líquido: valorBase + encargos - multa - juros (taxa adm já está
      // implicita no split — Fase 1 simplificada).
      const liquido = rc.valorBase + rc.encargos - rc.multa - rc.juros;
      const transfer = await tx.asaasTransfer.create({
        data: {
          orgId: ctx.orgId,
          accountId,
          value: liquido,
          type: "PIX",
          status: "PENDING_DISPATCH",
          pixAddressKey: principal?.owner.pixKey ?? null,
          pixKeyType: principal?.owner.pixKeyType ?? null,
          ownerName: principal?.owner.nome ?? null,
          ownerCpfCnpj: principal?.owner.cpfCnpj ?? null,
          requestedBy: ctx.userId,
          scheduledDate: new Date(),
          description: `Repasse aluguel ${rc.competencia} · ${rc.leaseContract?.property?.rua ?? ""} ${rc.leaseContract?.property?.numero ?? ""}`.trim(),
          origin: "split_dispatch",
          nfseRequerida: rc.leaseContract?.emitirNfse ?? false,
        },
      });
      createdTransfers++;
      await tx.rentCharge.update({
        where: { id: rc.id },
        data: {
          status: "repassada",
          repasseTransferId: transfer.id,
        },
      });
      updatedCharges++;
    }
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "RENT_MARK_REPASSED",
      result: "SUCCESS",
      resource: charges[0].id,
      resourceType: "RentCharge",
      metadata: {
        rentChargeIds: parsed.data.rentChargeIds,
        agrupado: parsed.data.agrupado,
        createdTransfers,
        updatedCharges,
      },
    }
  );

  return NextResponse.json({ ok: true, createdTransfers, updatedCharges });
}
