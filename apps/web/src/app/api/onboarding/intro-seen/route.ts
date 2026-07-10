import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/intro-seen — marca que o dono viu o modal de boas-vindas
 * do onboarding. Para o auto-redirect da home "/" (a sidebar segue guiando).
 * Idempotente; owner/admin.
 */
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { onboardingIntroSeenAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
