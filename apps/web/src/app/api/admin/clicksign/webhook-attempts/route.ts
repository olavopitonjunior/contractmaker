import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * GET /api/admin/clicksign/webhook-attempts
 *
 * Lista as últimas tentativas de webhook ClickSign registradas no
 * AuditLog. Usado pra diagnosticar:
 *  - Se o ClickSign está realmente mandando (count > 0)
 *  - Qual header está usando pra HMAC
 *  - Se algum batch chegou e foi processado vs rejeitado
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json(
      { error: "No organization" },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10), 1),
    100
  );

  const logs = await prisma.auditLog.findMany({
    where: {
      action: {
        in: ["CLICKSIGN_WEBHOOK_RECEIVED", "CLICKSIGN_WEBHOOK_REJECTED"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      result: true,
      createdAt: true,
      metadata: true,
    },
  });

  const received = logs.filter(
    (l) => l.action === "CLICKSIGN_WEBHOOK_RECEIVED"
  ).length;
  const rejected = logs.filter(
    (l) => l.action === "CLICKSIGN_WEBHOOK_REJECTED"
  ).length;

  return NextResponse.json({
    ok: true,
    summary: { received, rejected, total: logs.length },
    logs,
  });
}
