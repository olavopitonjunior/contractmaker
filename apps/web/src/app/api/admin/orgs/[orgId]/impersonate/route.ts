import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  IMPERSONATION_COOKIE as COOKIE,
  IMPERSONATION_TTL_SECONDS as TTL_SECONDS,
} from "@/lib/auth/impersonation";

// `reason` opcional: o switcher de tenant do header troca com 1 clique e manda o
// motivo padrão. O dialog do /admin/orgs continua mandando o motivo digitado —
// ambos ficam auditados em IMPERSONATION_STARTED.
const DEFAULT_REASON = "troca de tenant pelo switcher";
const bodySchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

async function requireSuperAdmin(userId: string): Promise<NextResponse | null> {
  try {
    await requirePlatformRole(userId, "super_admin");
    return null;
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return NextResponse.json(
        { error: err.code, requiredRole: err.requiredRole },
        { status: err.status }
      );
    }
    throw err;
  }
}

/** POST — inicia impersonação do tenant (super_admin). Seta cookie httpOnly 1h. */
export async function POST(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requireSuperAdmin(session.user.id);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "reason inválido (3-500 chars)" },
      { status: 400 }
    );
  }
  const reason = parsed.data.reason ?? DEFAULT_REASON;

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });
  }

  // Trocar de tenant A→B direto: encerra as sessões abertas em OUTRAS orgs antes
  // de abrir a nova. Sem isso ficavam N sessões ativas e o carimbo de auditoria
  // (getImpersonationAuditMeta) poderia casar com a sessão errada.
  await prisma.tenantImpersonationSession.updateMany({
    where: { adminUserId: session.user.id, endedAt: null },
    data: { endedAt: new Date() },
  });

  const endsAt = new Date(Date.now() + TTL_SECONDS * 1000);
  await prisma.tenantImpersonationSession.create({
    data: {
      adminUserId: session.user.id,
      orgId: org.id,
      reason,
      endsAt,
    },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "IMPERSONATION_STARTED",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: org.id,
    metadata: { impersonatedBy: session.user.id, reason, endsAt },
  });

  const res = NextResponse.json({ ok: true, org, endsAt });
  res.cookies.set(COOKIE, org.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return res;
}

/** DELETE — encerra a impersonação ativa (super_admin). Limpa cookie. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requireSuperAdmin(session.user.id);
  if (denied) return denied;

  await prisma.tenantImpersonationSession.updateMany({
    where: { adminUserId: session.user.id, orgId: params.orgId, endedAt: null },
    data: { endedAt: new Date() },
  });

  await audit(extractAuditContextFromRequest(req, params.orgId, session.user.id), {
    action: "IMPERSONATION_ENDED",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: params.orgId,
    metadata: { impersonatedBy: session.user.id },
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}
