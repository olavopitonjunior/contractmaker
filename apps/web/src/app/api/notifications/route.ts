import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

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
  // vazá-las pra toda a org.
  const audienceScope = {
    orgId: org.id,
    OR: [{ userId: null }, { userId: session.user.id }],
  };

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
  const result = await prisma.notification.updateMany({
    where: {
      orgId: org.id,
      read: false,
      OR: [{ userId: null }, { userId: session.user.id }],
    },
    data: { read: true, readAt: now },
  });

  return NextResponse.json({ ok: true, markedRead: result.count });
}
