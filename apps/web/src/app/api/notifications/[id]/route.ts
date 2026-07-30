import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * PATCH /api/notifications/:id
 * Marks a single notification as read.
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const notif = await prisma.notification.findUnique({
    where: { id: params.id },
  });
  if (!notif || notif.orgId !== org.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Row DIRECIONADA é privada do alvo — outro membro da org não pode marcar
  // como lida (o fan-out do gerente multiplicou as rows direcionadas; sem
  // este check, um gerente mexia no sino do colega). Org-wide (userId null)
  // segue compartilhada, comportamento histórico.
  if (notif.userId && notif.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!notif.read) {
    await prisma.notification.update({
      where: { id: params.id },
      data: { read: true, readAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true });
}
