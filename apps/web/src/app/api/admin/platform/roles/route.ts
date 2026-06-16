import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { PLATFORM_ROLES } from "@/lib/security/rbac/platform";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gestão de PlatformRole (staff de plataforma) pela UI — substitui o
 * `scripts/grant-platform-role.ts`. Gate: super_admin (GET inclusive, pois lista
 * quem tem acesso de plataforma — informação sensível).
 */

/** GET — lista o staff de plataforma. */
export async function GET() {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const roles = await prisma.platformRole.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, role: true, scope: true, createdAt: true, updatedAt: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: roles.map((r) => r.userId) } },
    select: { id: true, name: true, email: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  return NextResponse.json({
    roles: roles.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      name: userById.get(r.userId)?.name ?? null,
      email: userById.get(r.userId)?.email ?? null,
    })),
  });
}

const grantSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  role: z.enum(PLATFORM_ROLES as unknown as [string, ...string[]]),
  scope: z.array(z.string().trim()).optional().default([]),
});

/** POST — concede/atualiza uma PlatformRole por e-mail (upsert). */
export async function POST(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const parsed = grantSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validação falhou", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { email, role, scope } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    return NextResponse.json(
      { error: "USER_NOT_FOUND", message: `Usuário ${email} não encontrado` },
      { status: 404 }
    );
  }

  const saved = await prisma.platformRole.upsert({
    where: { userId: user.id },
    update: { role, scope },
    create: { userId: user.id, role, scope },
  });

  await audit(extractAuditContextFromRequest(req, "", session!.user!.id), {
    action: "PLATFORM_ROLE_GRANTED",
    result: "SUCCESS",
    resourceType: "PlatformRole",
    resource: saved.id,
    metadata: { targetUserId: user.id, email, role, scope },
  });

  return NextResponse.json({ ok: true, role: { id: saved.id, userId: saved.id, roleName: role, scope } });
}

const revokeSchema = z.object({ userId: z.string().min(1) });

/** DELETE — revoga a PlatformRole de um usuário. */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const parsed = revokeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
  }
  // Guarda anti-lockout: não deixar o super_admin revogar a própria role.
  if (parsed.data.userId === session!.user!.id) {
    return NextResponse.json(
      { error: "SELF_REVOKE_BLOCKED", message: "Você não pode revogar a própria role de plataforma." },
      { status: 409 }
    );
  }

  const existing = await prisma.platformRole.findUnique({ where: { userId: parsed.data.userId } });
  if (!existing) {
    return NextResponse.json({ ok: true, alreadyAbsent: true });
  }
  await prisma.platformRole.delete({ where: { userId: parsed.data.userId } });

  await audit(extractAuditContextFromRequest(req, "", session!.user!.id), {
    action: "PLATFORM_ROLE_REVOKED",
    result: "SUCCESS",
    resourceType: "PlatformRole",
    resource: existing.id,
    metadata: { targetUserId: parsed.data.userId, previousRole: existing.role },
  });

  return NextResponse.json({ ok: true });
}
