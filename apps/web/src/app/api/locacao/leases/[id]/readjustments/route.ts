import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import {
  calculateReadjustment,
  nextReadjustmentDate,
  type Indice,
} from "@/lib/locacao/readjustment-calculator";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

const readjustmentCreateSchema = z.object({
  indice: z.enum(["IGPM", "IPCA", "IGP-DI", "outro"]),
  percentualOverride: z.number().optional(),
  observacao: z.string().optional(),
  apply: z.boolean().default(false),
});

const readjustmentApproveSchema = z.object({
  readjustmentId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  observacao: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_VIEW);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const lease = await prisma.leaseContract.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!lease) return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });

  const readjustments = await prisma.leaseReadjustment.findMany({
    where: { leaseContractId: id, orgId: ctx.orgId },
    orderBy: { dataReajuste: "desc" },
  });
  return NextResponse.json({ readjustments });
}

/**
 * POST cria um reajuste manual. Se `apply=true`, marca como aplicado
 * imediatamente e atualiza LeaseContract.valorAluguel + dataProximoReajuste.
 * Senão, cria como "proposto" — aguarda approve via PATCH.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_EDIT);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const lease = await prisma.leaseContract.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, valorAluguel: true, dataProximoReajuste: true },
  });
  if (!lease) return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });

  const parsed = await parseJsonBody(req, readjustmentCreateSchema);
  if (!parsed.ok) return parsed.response;

  const calc = calculateReadjustment(
    lease.valorAluguel,
    parsed.data.indice as Indice,
    parsed.data.percentualOverride
  );

  const result = await prisma.$transaction(async (tx) => {
    const readj = await tx.leaseReadjustment.create({
      data: {
        orgId: ctx.orgId,
        leaseContractId: id,
        dataReajuste: new Date(),
        indice: calc.indice,
        percentualAplicado: calc.percentualAplicado,
        valorAnterior: calc.valorAnterior,
        valorNovo: calc.valorNovo,
        observacao: parsed.data.observacao,
        status: parsed.data.apply ? "aplicado" : "proposto",
        aprovadoEm: parsed.data.apply ? new Date() : null,
        aprovadoPor: parsed.data.apply ? ctx.userId : null,
      },
    });

    if (parsed.data.apply) {
      await tx.leaseContract.update({
        where: { id },
        data: {
          valorAluguel: calc.valorNovo,
          dataProximoReajuste: nextReadjustmentDate(new Date()),
        },
      });
    }

    return readj;
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: parsed.data.apply ? "LEASE_UPDATE" : "LEASE_UPDATE",
      result: "SUCCESS",
      resource: result.id,
      resourceType: "LeaseReadjustment",
      metadata: { applied: parsed.data.apply, percentual: calc.percentualAplicado },
    }
  );

  return NextResponse.json({ readjustment: result }, { status: 201 });
}

/**
 * PATCH approve/reject reajuste proposto. Approve aplica no contrato.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_EDIT);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const parsed = await parseJsonBody(req, readjustmentApproveSchema);
  if (!parsed.ok) return parsed.response;

  const readj = await prisma.leaseReadjustment.findFirst({
    where: { id: parsed.data.readjustmentId, orgId: ctx.orgId, leaseContractId: id },
  });
  if (!readj) {
    return NextResponse.json({ error: "Reajuste não encontrado" }, { status: 404 });
  }
  if (readj.status !== "proposto" && readj.status !== "aprovado") {
    return NextResponse.json(
      { error: "Reajuste já foi aplicado ou recusado" },
      { status: 409 }
    );
  }

  if (parsed.data.action === "reject") {
    await prisma.leaseReadjustment.update({
      where: { id: readj.id },
      data: {
        status: "recusado",
        observacao: parsed.data.observacao ?? readj.observacao,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Approve → aplica.
  await prisma.$transaction([
    prisma.leaseReadjustment.update({
      where: { id: readj.id },
      data: {
        status: "aplicado",
        aprovadoEm: new Date(),
        aprovadoPor: ctx.userId,
      },
    }),
    prisma.leaseContract.update({
      where: { id },
      data: {
        valorAluguel: readj.valorNovo,
        dataProximoReajuste: nextReadjustmentDate(new Date()),
      },
    }),
  ]);

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "LEASE_UPDATE",
      result: "SUCCESS",
      resource: readj.id,
      resourceType: "LeaseReadjustment",
      metadata: { applied: true, valorNovo: readj.valorNovo },
    }
  );
  return NextResponse.json({ ok: true });
}
