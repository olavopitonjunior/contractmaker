import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { rentChargeListQuerySchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

const rentChargeCreateSchema = z.object({
  leaseContractId: z.string().min(1),
  kind: z.enum(["extra", "encargo"]).default("extra"),
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
  dueDate: z.coerce.date(),
  valorBase: z.number().positive(),
  encargos: z.number().nonnegative().default(0),
});

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.RENT_VIEW);
  if (isRouteError(ctx)) return ctx;

  const url = new URL(req.url);
  const parsed = rentChargeListQuerySchema.safeParse({
    leaseContractId: url.searchParams.get("leaseContractId") ?? undefined,
    competencia: url.searchParams.get("competencia") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", details: parsed.error.flatten() }, { status: 422 });
  }

  const charges = await prisma.rentCharge.findMany({
    where: {
      orgId: ctx.orgId,
      ...(parsed.data.leaseContractId ? { leaseContractId: parsed.data.leaseContractId } : {}),
      ...(parsed.data.competencia ? { competencia: parsed.data.competencia } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    },
    include: {
      leaseContract: {
        select: {
          id: true,
          property: { select: { rua: true, numero: true } },
        },
      },
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });
  return NextResponse.json({ charges });
}

/**
 * POST /api/locacao/rent-charges — criar cobrança extra (kind="extra" ou "encargo").
 * Aluguel mensal regular é criado pelo cron rent-scheduler, não aqui.
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.RENT_GENERATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, rentChargeCreateSchema);
  if (!parsed.ok) return parsed.response;

  const lc = await prisma.leaseContract.findFirst({
    where: { id: parsed.data.leaseContractId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!lc) return NextResponse.json({ error: "Contrato não pertence à org" }, { status: 422 });

  try {
    const charge = await prisma.rentCharge.create({
      data: {
        orgId: ctx.orgId,
        leaseContractId: parsed.data.leaseContractId,
        kind: parsed.data.kind,
        competencia: parsed.data.competencia,
        dueDate: parsed.data.dueDate,
        valorBase: parsed.data.valorBase,
        encargos: parsed.data.encargos,
        status: "pendente",
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId },
      {
        action: "RENT_CHARGE_GENERATE",
        result: "SUCCESS",
        resource: charge.id,
        resourceType: "RentCharge",
        metadata: { kind: charge.kind, competencia: charge.competencia, valor: charge.valorBase },
      }
    );

    return NextResponse.json({ charge }, { status: 201 });
  } catch (err) {
    // Provavel conflito de unique (leaseContractId, competencia, kind).
    return NextResponse.json(
      { error: "Cobrança já existe nessa competência/kind", details: String(err) },
      { status: 409 }
    );
  }
}
