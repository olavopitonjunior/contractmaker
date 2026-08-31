import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { can, getEffectivePermissions } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { isApprover } from "@/lib/auth/invitations";

/**
 * GET /api/auth/permissions
 * Retorna permissions efetivas do user atual (usado pelo front para gating).
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  // Ator humano: sob impersonation o gate de plataforma é sobre o admin real,
  // não sobre o dono do tenant que o RBAC resolve.
  const platformApprover = isApprover(ctx.impersonatedByEmail ?? ctx.userEmail);

  const effective = await getEffectivePermissions(ctx.userId, ctx.orgId);
  if (!effective) {
    // Sem membership, mas na allowlist de env: é exatamente o caso que a porta
    // de emergência existe para servir, e `canApproveInvitations` aceitaria o
    // POST. Devolver 403 aqui deixaria o servidor aberto e a UI fechada —
    // `usePermissions` cai para `false` em resposta não-ok e o botão some.
    if (platformApprover) {
      return NextResponse.json({
        userId: ctx.userId,
        orgId: ctx.orgId,
        role: null,
        customRoleName: null,
        permissions: {},
        isInvitationApprover: true,
      });
    }
    return NextResponse.json(
      { error: "Membership não encontrada" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    userId: effective.userId,
    orgId: effective.orgId,
    role: effective.role,
    customRoleName: effective.customRoleName,
    permissions: effective.permissions,
    // Espelha `canApproveInvitations` do servidor — o mesmo OR (allowlist de
    // env OU `org.members.approve`) que os endpoints de approve/reject
    // aplicam, inclusive lendo o ator real sob impersonation. Divergir aqui
    // só esconde o botão de quem pode clicar.
    isInvitationApprover:
      platformApprover || can(effective, PERMISSION.ORG_MEMBERS_APPROVE),
  });
}
