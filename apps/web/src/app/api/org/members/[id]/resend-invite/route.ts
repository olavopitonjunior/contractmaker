import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import {
  requireElevation,
  ElevationRequiredError,
} from "@/lib/security/elevation";
import { sendEmail } from "@/lib/email/client";
import { WelcomeSetPasswordEmail } from "@/lib/email/templates/password-reset";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";

/**
 * POST /api/org/members/[id]/resend-invite — gera novo token welcome
 * e reenvia email. Útil quando o link original expirou.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id: membershipId } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_MEMBERS_INVITE,
    });
    await requireElevation(ctx.userId, "MEMBER_MANAGE");
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError ||
      err instanceof ElevationRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const membership = await prisma.orgMembership.findFirst({
    where: { id: membershipId, orgId: ctx.orgId },
    include: { user: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
  }

  // Rate limit: 3 reenvios / hora por membership
  const rl = await rateLimit({
    identifier: `resend-invite:${membershipId}`,
    limit: 3,
    window: "1 h",
  });
  if (!rl.success) {
    return NextResponse.json(
      { error: "Limite de reenvios atingido. Aguarde uma hora." },
      { status: 429 }
    );
  }

  const email = membership.user.email;
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const { token } = await createPasswordResetToken(email, "welcome");
  const setupUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  await sendEmail({
    to: email,
    subject: `Bem-vindo a ${ctx.orgName} no Contractmaker`,
    react: WelcomeSetPasswordEmail({
      inviterName: ctx.userName,
      orgName: ctx.orgName,
      setupUrl,
    }) as any,
  });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "MEMBER_INVITE_RESENT",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${membership.id}`,
      metadata: { targetUserId: membership.userId },
    }
  );

  return NextResponse.json({ ok: true });
}
