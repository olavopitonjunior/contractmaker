import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { requireElevation, ElevationRequiredError } from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";

const ROLE_VALUES = [
  "admin",
  "finance",
  "sales",
  "gerente",
  "viewer",
  "custom",
] as const;

const patchSchema = z.object({
  role: z.enum(ROLE_VALUES).optional(),
  customRoleId: z.string().nullable().optional(),
});

async function ensureNotLastAdmin(orgId: string, excludeMembershipId: string) {
  const adminCount = await prisma.orgMembership.count({
    where: {
      orgId,
      role: { in: ["owner", "admin"] },
      id: { not: excludeMembershipId },
    },
  });
  if (adminCount === 0) {
    throw new Error("LAST_ADMIN");
  }
}

/**
 * PATCH /api/org/members/[id] — altera role do membro.
 */
export async function PATCH(
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
      permission: PERMISSION.ORG_MEMBERS_CHANGE_ROLE,
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
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
  }
  if (membership.userId === ctx.userId) {
    return NextResponse.json(
      { error: "Você não pode alterar seu próprio papel" },
      { status: 422 }
    );
  }
  if (membership.role === "owner") {
    return NextResponse.json(
      { error: "Use /transfer-ownership para mover o owner" },
      { status: 422 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // Admin não pode promover a owner nem alterar role de outro admin
  const actorMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (actorMembership?.role === "admin") {
    if (parsed.data.role === "custom" && !parsed.data.customRoleId) {
      return NextResponse.json(
        { error: "customRoleId obrigatório quando role=custom" },
        { status: 400 }
      );
    }
    // Admin NÃO pode rebaixar outro admin (só owner pode)
    if (membership.role === "admin" && ctx.userId !== membership.userId) {
      return NextResponse.json(
        { error: "Apenas o owner pode rebaixar admins" },
        { status: 403 }
      );
    }
  }

  // Se está rebaixando de admin, garante que não é o último
  if (membership.role === "admin" && parsed.data.role && parsed.data.role !== "admin") {
    try {
      await ensureNotLastAdmin(ctx.orgId, membership.id);
    } catch {
      return NextResponse.json(
        { error: "Não é possível rebaixar o último administrador" },
        { status: 422 }
      );
    }
  }

  const updated = await prisma.orgMembership.update({
    where: { id: membership.id },
    data: {
      role: parsed.data.role ?? membership.role,
      customRoleId:
        parsed.data.customRoleId === null ? null : parsed.data.customRoleId ?? membership.customRoleId,
    },
  });

  // Dois audit logs: um para quem alterou, outro referenciando o alvo
  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "MEMBER_ROLE_CHANGED",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${updated.id}`,
      metadata: {
        targetUserId: membership.userId,
        previousRole: membership.role,
        newRole: updated.role,
      },
    }
  );
  await audit(
    { orgId: ctx.orgId, userId: membership.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "MEMBER_ROLE_CHANGED_TARGET",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${updated.id}`,
      metadata: {
        changedByUserId: ctx.userId,
        previousRole: membership.role,
        newRole: updated.role,
      },
    }
  );

  return NextResponse.json({ membership: updated });
}

/**
 * DELETE /api/org/members/[id] — remove membro.
 */
export async function DELETE(
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
      permission: PERMISSION.ORG_MEMBERS_REMOVE,
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
  });
  if (!membership) {
    return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
  }
  if (membership.userId === ctx.userId) {
    return NextResponse.json(
      {
        error:
          "Você não pode se remover por aqui — use 'Sair da organização'",
      },
      { status: 422 }
    );
  }
  if (membership.role === "owner") {
    return NextResponse.json(
      { error: "Não é possível remover o owner — use transfer-ownership" },
      { status: 422 }
    );
  }

  // Membership de agente, não de gente. O Bearer do agente resolve a org pela
  // membership do dono do token, então remover esta linha derruba o agente
  // naquele tenant — e em silêncio, porque nada falha até a próxima chamada.
  // O caminho de desligar é a feature no painel, que revoga o token e avisa o
  // serviço; aqui só sobraria um agente órfão com credencial válida.
  if (membership.isSystem) {
    return NextResponse.json(
      {
        error:
          "Este é um usuário de serviço de um agente. Desligue o agente nos módulos da organização em vez de remover o membro.",
      },
      { status: 422 }
    );
  }

  // Último admin guard
  if (membership.role === "admin") {
    try {
      await ensureNotLastAdmin(ctx.orgId, membership.id);
    } catch {
      return NextResponse.json(
        { error: "Não é possível remover o último administrador" },
        { status: 422 }
      );
    }
  }

  await prisma.orgMembership.delete({ where: { id: membership.id } });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "MEMBER_REMOVED",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${membership.id}`,
      metadata: { targetUserId: membership.userId, role: membership.role },
    }
  );

  return NextResponse.json({ ok: true });
}
