import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getOnboardingStatus } from "@/lib/onboarding/status";
// Mesmo gate do checklist/redirect (lib/onboarding/gate.ts) — ver e concluir o
// onboarding são a mesma permissão: owner|admin.
import { resolveOnboardingActor } from "@/lib/onboarding/gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/onboarding/complete — status derivado do onboarding (pra rehidratar o wizard). */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const status = await getOnboardingStatus(org.id);
  return NextResponse.json(status);
}

/**
 * POST /api/onboarding/complete — marca o tour como concluído/pulado.
 * Só seta o timestamp (idempotente): o progresso real continua derivado dos dados.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const { isOwnerAdmin } = await resolveOnboardingActor(session.user.id, org.id);
  if (!isOwnerAdmin) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem concluir o onboarding." },
      { status: 403 }
    );
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { onboardingCompletedAt: new Date() },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "ORG_ONBOARDING_COMPLETED",
    result: "SUCCESS",
    resource: org.id,
    resourceType: "Organization",
  });

  return NextResponse.json({ ok: true });
}
