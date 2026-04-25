import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { revokeElevation } from "@/lib/security/elevation";

/**
 * POST /api/org/members/leave — usuário sai da própria organização.
 *
 * Bloqueado para owners (precisa transferir ownership antes).
 * Não pode ser o último admin (último admin precisa ser substituído antes).
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Membership não encontrada" }, { status: 404 });
  }

  if (membership.role === "owner") {
    return NextResponse.json(
      {
        error:
          "Owner não pode sair — transfira a propriedade primeiro ou exclua a organização.",
      },
      { status: 422 }
    );
  }

  if (membership.role === "admin") {
    const otherAdminCount = await prisma.orgMembership.count({
      where: {
        orgId: ctx.orgId,
        role: { in: ["owner", "admin"] },
        id: { not: membership.id },
      },
    });
    if (otherAdminCount === 0) {
      return NextResponse.json(
        {
          error:
            "Você é o último administrador. Promova outro membro antes de sair.",
        },
        { status: 422 }
      );
    }
  }

  await prisma.orgMembership.delete({ where: { id: membership.id } });

  // Revoga elevation antes de apagar a sessão para evitar token órfão
  await revokeElevation();

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "MEMBER_LEFT",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${membership.id}`,
      metadata: { role: membership.role },
    }
  ).catch((err) => console.warn("[leave-org] audit fail", err));

  return NextResponse.json({ ok: true });
}
