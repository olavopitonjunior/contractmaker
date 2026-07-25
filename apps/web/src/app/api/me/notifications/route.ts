import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/notifications?unread=1&limit=20
 *
 * Avisos do usuário autenticado — pro Newton responder "tenho algo pendente?"
 * pelo WhatsApp. Auth: Bearer (`metrics:r`) OU session.
 *
 * Rota separada de /api/notifications (que é da UI e usa `auth()` direto) por
 * dois motivos: aquela não aceita Bearer, e aqui o escopo tem que sair do
 * `actor.effectiveUserId` — com delegação `X-Act-As-User`, usar o dono do
 * token devolveria os avisos da pessoa errada (o Newton fala com quem está do
 * outro lado do WhatsApp, não com o dono do token de serviço).
 *
 * Mesma regra de visibilidade da UI: org-wide (`userId: null`) OU dirigidas a
 * mim — notificação dirigida a outra pessoa é privada.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "metrics:r" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
    : 20;

  const userId = auth.actor.effectiveUserId;

  const rows = await prisma.notification.findMany({
    where: {
      orgId: auth.org.id,
      OR: [{ userId: null }, { userId }],
      ...(unreadOnly ? { read: false } : {}),
    },
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      linkUrl: true,
      read: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    notifications: rows.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
    })),
    count: rows.length,
  });
}
