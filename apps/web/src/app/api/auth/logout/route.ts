import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { revokeElevation } from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/auth/logout — limpeza server-side antes do signOut do NextAuth.
 *
 * O signOut() do NextAuth (client) só apaga o cookie de sessão. Esta rota:
 *   - revoga o cookie de elevação (sudo)
 *   - apaga sessões DB do user (defesa em profundidade — força re-login)
 *   - registra LOGOUT no AuditLog
 *
 * Idempotente: se a sessão já não existe, ainda retorna 200.
 */
export async function POST(req: NextRequest) {
  const session = await auth();

  // Sempre limpa o cookie de elevation (mesmo sem sessão ativa)
  await revokeElevation();

  if (session?.user?.id) {
    const userId = session.user.id;

    // Apaga sessões DB ativas (NextAuth usa JWT por default mas pode haver
    // entradas de Account/Session se OAuth estiver configurado no futuro).
    await prisma.session
      .deleteMany({ where: { userId } })
      .catch((err) => console.warn("[logout] session cleanup", err));

    // Best-effort audit — busca primeira org do user para escopar o log.
    const membership = await prisma.orgMembership.findFirst({
      where: { userId },
      select: { orgId: true },
    });

    if (membership) {
      await audit(
        {
          orgId: membership.orgId,
          userId,
          ipAddress:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
        {
          action: "USER_LOGOUT",
          result: "SUCCESS",
          resourceType: "user",
          resource: `user:${userId}`,
        }
      ).catch((err) => console.warn("[logout] audit fail", err));
    }
  }

  return NextResponse.json({ ok: true });
}
