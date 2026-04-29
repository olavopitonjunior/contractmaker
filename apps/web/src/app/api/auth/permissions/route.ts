import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { getEffectivePermissions } from "@/lib/security/rbac/check";
import { isApprover } from "@/lib/auth/invitations";

/**
 * GET /api/auth/permissions
 * Retorna permissions efetivas do user atual (usado pelo front para gating).
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const effective = await getEffectivePermissions(ctx.userId, ctx.orgId);
  if (!effective) {
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
    isInvitationApprover: isApprover(ctx.userEmail),
  });
}
