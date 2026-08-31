import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/context";
import { audit } from "@/lib/security/audit";
import { canApproveInvitations } from "@/lib/auth/invitations";

const rejectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/**
 * POST /api/org/invitations/:id/reject — rejeita convite. Mesmo gate de
 * approve: permissão `org.members.approve` (owner/admin) ou a allowlist
 * INVITE_APPROVER_EMAILS.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  const allowed = await canApproveInvitations({
    userId: ctx.userId,
    orgId: ctx.orgId,
    email: ctx.userEmail,
    impersonatedByEmail: ctx.impersonatedByEmail,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Você não tem permissão para reprovar acessos" },
      { status: 403 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = rejectSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const invitation = await prisma.orgInvitation.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true, email: true },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Convite não encontrado" }, { status: 404 });
  }
  if (invitation.status !== "pending") {
    return NextResponse.json(
      { error: `Convite não está pendente (status atual: ${invitation.status})` },
      { status: 409 }
    );
  }

  await prisma.orgInvitation.update({
    where: { id },
    data: {
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: parsed.data.reason ?? null,
      approvedById: ctx.userId, // quem decidiu (mesmo sendo reject)
    },
  });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "INVITATION_REJECTED",
      result: "SUCCESS",
      resourceType: "org_invitation",
      resource: `org_invitation:${id}`,
      metadata: { email: invitation.email, reason: parsed.data.reason ?? null },
    }
  );

  return NextResponse.json({ ok: true });
}
