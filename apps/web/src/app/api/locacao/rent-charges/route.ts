import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { rentChargeListQuerySchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

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
