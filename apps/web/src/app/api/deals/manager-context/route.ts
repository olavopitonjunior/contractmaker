import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/context";
import { getManagerSettings } from "@/lib/deals/manager";

export const runtime = "nodejs";

/**
 * GET /api/deals/manager-context — contexto de gerente pros fluxos de CRIAÇÃO
 * de negócio (form vendas/locação, upload, proposta, iList).
 *
 * Gated só por membership (requireAuth): as páginas de criação são usadas por
 * corretores sem permissão de settings, mas todos precisam saber se o gerente
 * é obrigatório e quem são os candidatos. Não expõe nada sensível — só o
 * toggle e nome/e-mail de membros com role gerente.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const [{ managerRequired }, managers] = await Promise.all([
    getManagerSettings(ctx.orgId),
    prisma.orgMembership.findMany({
      where: { orgId: ctx.orgId, role: "gerente", user: { deletedAt: null } },
      select: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { invitedAt: "asc" },
    }),
  ]);

  return NextResponse.json({
    managerRequired,
    candidates: managers.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
    })),
  });
}
