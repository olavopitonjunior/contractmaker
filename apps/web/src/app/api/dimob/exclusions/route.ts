import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseYear(sp: URLSearchParams): number | null {
  const y = Number(sp.get("year"));
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  return y;
}

async function auth(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return { error: authResult.response } as const;
  const { ctx } = authResult;
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.REPORT_EXPORT,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return { error: NextResponse.json({ error: err.code }, { status: err.status }) } as const;
    }
    throw err;
  }
  return { ctx } as const;
}

const PostBody = z
  .object({
    dealId: z.string().min(1).optional(),
    leaseId: z.string().min(1).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => Boolean(v.dealId) !== Boolean(v.leaseId), {
    message: "Informe dealId OU leaseId (exatamente um)",
  });

/** POST — exclui uma venda (`dealId`) ou uma locação (`leaseId`) da DIMOB do ano. */
export async function POST(req: NextRequest) {
  const a = await auth(req);
  if ("error" in a) return a.error;
  const year = parseYear(new URL(req.url).searchParams);
  if (year === null) return NextResponse.json({ error: "Ano inválido" }, { status: 400 });

  const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { dealId, leaseId, reason } = parsed.data;

  if (leaseId) {
    // Cross-org guard: o contrato de locação precisa pertencer à org do usuário.
    const lease = await prisma.leaseContract.findFirst({
      where: { id: leaseId, orgId: a.ctx.orgId },
      select: { id: true },
    });
    if (!lease) return NextResponse.json({ error: "Locação não encontrada" }, { status: 404 });

    await prisma.dimobExclusion.upsert({
      where: { orgId_year_leaseId: { orgId: a.ctx.orgId, year, leaseId } },
      create: { orgId: a.ctx.orgId, year, leaseId, reason: reason || null, excludedByUserId: a.ctx.userId },
      update: { reason: reason || null, excludedByUserId: a.ctx.userId },
    });

    await audit(extractAuditContextFromRequest(req, a.ctx.orgId, a.ctx.userId), {
      action: "DIMOB_SALE_EXCLUDED",
      result: "SUCCESS",
      resource: leaseId,
      resourceType: "LeaseContract",
      metadata: { year, reason: reason || null, kind: "locacao" },
    });

    return NextResponse.json({ excluded: true, leaseId, year });
  }

  // Cross-org guard: o deal precisa pertencer à org do usuário.
  const deal = await prisma.deal.findFirst({
    where: { id: dealId!, pipeline: { orgId: a.ctx.orgId } },
    select: { id: true },
  });
  if (!deal) return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });

  await prisma.dimobExclusion.upsert({
    where: { orgId_year_dealId: { orgId: a.ctx.orgId, year, dealId: dealId! } },
    create: { orgId: a.ctx.orgId, year, dealId: dealId!, reason: reason || null, excludedByUserId: a.ctx.userId },
    update: { reason: reason || null, excludedByUserId: a.ctx.userId },
  });

  await audit(extractAuditContextFromRequest(req, a.ctx.orgId, a.ctx.userId), {
    action: "DIMOB_SALE_EXCLUDED",
    result: "SUCCESS",
    resource: dealId!,
    resourceType: "Deal",
    metadata: { year, reason: reason || null },
  });

  return NextResponse.json({ excluded: true, dealId, year });
}

/** DELETE — reconcilia: re-inclui uma venda (`?dealId=`) ou todas (`?all=true`). */
export async function DELETE(req: NextRequest) {
  const a = await auth(req);
  if ("error" in a) return a.error;
  const sp = new URL(req.url).searchParams;
  const year = parseYear(sp);
  if (year === null) return NextResponse.json({ error: "Ano inválido" }, { status: 400 });

  if (sp.get("all") === "true") {
    const { count } = await prisma.dimobExclusion.deleteMany({
      where: { orgId: a.ctx.orgId, year },
    });
    await audit(extractAuditContextFromRequest(req, a.ctx.orgId, a.ctx.userId), {
      action: "DIMOB_RECONCILED_ALL",
      result: "SUCCESS",
      resource: a.ctx.orgId,
      resourceType: "Organization",
      metadata: { year, count },
    });
    return NextResponse.json({ reconciled: count, year });
  }

  const leaseId = sp.get("leaseId");
  if (leaseId) {
    await prisma.dimobExclusion.deleteMany({ where: { orgId: a.ctx.orgId, year, leaseId } });
    await audit(extractAuditContextFromRequest(req, a.ctx.orgId, a.ctx.userId), {
      action: "DIMOB_SALE_RECONCILED",
      result: "SUCCESS",
      resource: leaseId,
      resourceType: "LeaseContract",
      metadata: { year, kind: "locacao" },
    });
    return NextResponse.json({ reconciled: 1, leaseId, year });
  }

  const dealId = sp.get("dealId");
  if (!dealId) return NextResponse.json({ error: "dealId, leaseId ou all=true obrigatório" }, { status: 400 });

  await prisma.dimobExclusion.deleteMany({ where: { orgId: a.ctx.orgId, year, dealId } });
  await audit(extractAuditContextFromRequest(req, a.ctx.orgId, a.ctx.userId), {
    action: "DIMOB_SALE_RECONCILED",
    result: "SUCCESS",
    resource: dealId,
    resourceType: "Deal",
    metadata: { year },
  });

  return NextResponse.json({ reconciled: 1, dealId, year });
}
