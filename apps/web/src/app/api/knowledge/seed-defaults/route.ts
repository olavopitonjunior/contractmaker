import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { seedAndEmbedDefaultClauses } from "@/lib/knowledge/seed-clauses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/knowledge/seed-defaults
 *
 * Botão "Usar cláusulas padrão" do onboarding: semeia a biblioteca-base
 * conforme os módulos da org (vendas G1..G6 e/ou locação Lei 8.245/91).
 * Idempotente por (orgId, category:"clause", title). Embedding em background.
 */
export async function POST(req: NextRequest) {
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
    return NextResponse.json(
      { error: "Apenas owner/admin podem semear cláusulas." },
      { status: 403 }
    );
  }

  const { created, skipped, embed } = await seedAndEmbedDefaultClauses({
    orgId: org.id,
    createdBy: effUserId,
  });
  // Embedding best-effort em background — responde já, não segura no Voyage.
  if (embed) waitUntil(embed);

  return NextResponse.json({ created, skipped });
}
