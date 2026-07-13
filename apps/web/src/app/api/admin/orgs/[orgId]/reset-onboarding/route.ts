import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { getOnboardingStatus } from "@/lib/onboarding/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orgs/[orgId]/reset-onboarding — reabre o guia "Primeiros passos"
 * pro owner do tenant. Gated (super_admin).
 *
 * Zera `onboardingCompletedAt` (gate do checklist na sidebar) e `onboardingIntroSeenAt`
 * (modal de boas-vindas + redirect do 1º acesso). Necessário porque a migration de
 * backfill marcou TODAS as orgs existentes como concluídas, sem critério.
 *
 * Atenção: o checklist se auto-encerra quando os 6 passos estão de fato cumpridos
 * (o componente chama POST /api/onboarding/complete). Numa org já 100% completa o
 * reset não "cola" — por isso a resposta devolve o status derivado, pra deixar claro
 * o que ainda está pendente.
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
    select: { id: true, onboardingCompletedAt: true },
  });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  await prisma.organization.update({
    where: { id: org.id },
    data: { onboardingCompletedAt: null, onboardingIntroSeenAt: null },
  });

  const status = await getOnboardingStatus(org.id);

  await audit(extractAuditContextFromRequest(req, org.id, session!.user!.id), {
    action: "ORG_ONBOARDING_RESET",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: org.id,
    metadata: {
      previouslyCompletedAt: org.onboardingCompletedAt?.toISOString() ?? null,
      derivedComplete: status.complete,
      pendingSteps: status.steps.filter((s) => !s.done).map((s) => s.key),
    },
  });

  return NextResponse.json({
    ok: true,
    // true = os 6 fatos já são verdadeiros → o checklist vai se re-encerrar sozinho.
    alreadyComplete: status.complete,
    pendingSteps: status.steps.filter((s) => !s.done).map((s) => s.key),
  });
}
