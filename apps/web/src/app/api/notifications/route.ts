import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

/**
 * Escopo de leitura do sino (feature Gerente): usuário com visão RESTRITA de
 * deals (DEAL_VIEW_ASSIGNED_ONLY sem DEAL_VIEW_ALL) NÃO vê as rows org-wide —
 * só as direcionadas a ele. Tudo dos deals dele chega via fan-out na escrita
 * (emitNotification cria a row direcionada). Sem isso o gerente veria o sino
 * de todos os deals da org, furando o escopo do kanban.
 */
async function bellScope(
  userId: string,
  orgId: string
): Promise<{ orgId: string; OR?: { userId: string | null }[]; userId?: string }> {
  const eff = await getEffectivePermissions(userId, orgId);
  const restricted =
    can(eff, PERMISSION.DEAL_VIEW_ASSIGNED_ONLY) &&
    !can(eff, PERMISSION.DEAL_VIEW_ALL);
  return restricted
    ? { orgId, userId }
    : { orgId, OR: [{ userId: null }, { userId }] };
}

/**
 * GET /api/notifications?unread=1&limit=20
 *
 * Lists notifications scoped to the current org. Optionally filters to
 * unread only. Returns items + unreadCount so the bell badge can render
 * without a second request.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "1";
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

  // Notificações com `userId` são DIRECIONADAS ao alvo; as org-wide têm
  // userId=null. Escopo = org + (org-wide OU minhas). Isso torna privadas as
  // notificações direcionadas (ex.: support_answered, dual-approval), em vez de
  // vazá-las pra toda a org. Visão restrita (gerente) só vê as direcionadas.
  const audienceScope = await bellScope(session.user.id, org.id);

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        ...audienceScope,
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: { ...audienceScope, read: false },
    }),
  ]);

  return NextResponse.json({ items, unreadCount });
}

/**
 * POST /api/notifications
 * Body: { action: "read-all" }
 * Marks all unread notifications in the org as read.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.action !== "read-all") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const now = new Date();
  const scope = await bellScope(session.user.id, org.id);
  const result = await prisma.notification.updateMany({
    where: { ...scope, read: false },
    data: { read: true, readAt: now },
  });

  return NextResponse.json({ ok: true, markedRead: result.count });
}
