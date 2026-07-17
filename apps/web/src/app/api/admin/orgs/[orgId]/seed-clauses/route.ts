import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { seedAndEmbedDefaultClauses } from "@/lib/knowledge/seed-clauses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orgs/[orgId]/seed-clauses — super_admin semeia a
 * biblioteca-base de cláusulas num tenant específico (banco pelos módulos da
 * org). Idempotente. Botão "Semear cláusulas padrão" no detalhe do tenant.
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
    select: { id: true },
  });
  if (!org) return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });

  const { created, skipped, embed } = await seedAndEmbedDefaultClauses({
    orgId: org.id,
    createdBy: session!.user!.id,
  });
  if (embed) waitUntil(embed);

  await audit(extractAuditContextFromRequest(req, org.id, session!.user!.id), {
    action: "ORG_UPDATED",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: org.id,
    metadata: { event: "seed_clauses", created, skipped },
  });

  return NextResponse.json({ created, skipped });
}
