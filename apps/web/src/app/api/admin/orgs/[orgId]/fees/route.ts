import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Taxas/políticas financeiras do tenant. OrgFinancialSettings é por-conta Asaas
 * (accountId @unique) — uma org pode ter N. Este editor admin aplica os campos
 * de taxa/política a TODAS as rows de OrgFinancialSettings da org (override em
 * massa). GET retorna as rows pra inspeção. Gate: PATCH super_admin, GET support+.
 */
const feesSchema = z
  .object({
    platformFeePercent: z.number().min(0).max(100).optional(),
    finePercent: z.number().min(0).max(100).optional(),
    interestPercentMonth: z.number().min(0).max(100).optional(),
    defaultDueDays: z.number().int().min(0).max(365).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Nenhum campo para atualizar" });

export async function GET(_req: NextRequest, { params }: { params: { orgId: string } }) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;
  const settings = await prisma.orgFinancialSettings.findMany({
    where: { orgId: params.orgId },
    select: {
      id: true,
      accountId: true,
      platformFeePercent: true,
      finePercent: true,
      interestPercentMonth: true,
      defaultDueDays: true,
    },
  });
  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest, { params }: { params: { orgId: string } }) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const org = await prisma.organization.findUnique({ where: { id: params.orgId }, select: { id: true } });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  const parsed = feesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validação falhou", issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await prisma.orgFinancialSettings.updateMany({
    where: { orgId: org.id },
    data: parsed.data,
  });

  await audit(extractAuditContextFromRequest(req, org.id, session!.user!.id), {
    action: "ORG_FEES_UPDATED",
    result: "SUCCESS",
    resourceType: "OrgFinancialSettings",
    resource: org.id,
    metadata: { fields: Object.keys(parsed.data), rowsAffected: result.count },
  });

  return NextResponse.json({ ok: true, rowsAffected: result.count });
}
