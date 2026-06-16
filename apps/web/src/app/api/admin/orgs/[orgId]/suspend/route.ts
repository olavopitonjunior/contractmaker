import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Suspensão administrativa de tenant (super_admin).
 * POST   → suspende: seta `Organization.suspendedAt` + desliga todos os módulos.
 * DELETE → reativa: limpa `suspendedAt` + religa todos os módulos.
 *
 * O guard do dashboard usa `suspendedAt` para bloquear acesso; o desligamento
 * em massa dos módulos é redundância (a sidebar/enforcement já reage).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, suspendedAt: true },
  });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });
  if (org.suspendedAt) {
    return NextResponse.json({ ok: true, alreadySuspended: true });
  }

  const enabledBefore = await prisma.orgModule.findMany({
    where: { orgId: org.id, enabled: true },
    select: { module: true },
  });

  await prisma.$transaction([
    prisma.organization.update({ where: { id: org.id }, data: { suspendedAt: new Date() } }),
    prisma.orgModule.updateMany({ where: { orgId: org.id }, data: { enabled: false } }),
  ]);

  await audit(extractAuditContextFromRequest(req, org.id, session!.user!.id), {
    action: "ORG_SUSPENDED",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: org.id,
    metadata: { modulesEnabledBefore: enabledBefore.map((m) => m.module) },
  });

  return NextResponse.json({ ok: true, suspended: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, suspendedAt: true },
  });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });
  if (!org.suspendedAt) {
    return NextResponse.json({ ok: true, alreadyActive: true });
  }

  await prisma.$transaction([
    prisma.organization.update({ where: { id: org.id }, data: { suspendedAt: null } }),
    prisma.orgModule.updateMany({ where: { orgId: org.id }, data: { enabled: true } }),
  ]);

  await audit(extractAuditContextFromRequest(req, org.id, session!.user!.id), {
    action: "ORG_REACTIVATED",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: org.id,
  });

  return NextResponse.json({ ok: true, reactivated: true });
}
