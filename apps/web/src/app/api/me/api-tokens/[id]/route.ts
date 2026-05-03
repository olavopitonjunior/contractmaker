import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { revokeApiToken } from "@/lib/auth/api-token";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

/**
 * DELETE /api/me/api-tokens/{id} — revoga token. Idempotente: token já
 * revogado retorna 200 sem alterar `revokedAt`.
 *
 * Auth: session-only.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const revoked = await revokeApiToken(params.id, session.user.id);

  // orgId para audit (best-effort).
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: session.user.id },
    select: { orgId: true },
  });
  if (membership) {
    await audit(
      extractAuditContextFromRequest(req, membership.orgId, session.user.id),
      {
        action: "API_TOKEN_REVOKED",
        result: revoked ? "SUCCESS" : "FAILURE",
        resource: params.id,
        resourceType: "UserApiToken",
        metadata: { alreadyRevoked: !revoked },
      }
    );
  }

  return NextResponse.json({ revoked });
}
