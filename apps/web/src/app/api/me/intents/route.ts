import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

/**
 * GET /api/me/intents?status=pending
 *
 * Lista intents da org+user atual. Bearer (qualquer scope) ou session.
 *
 * Query:
 *   - status: pending | approved | rejected | executed | expired | failed
 *   - limit: 1-100, default 50
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1),
    100
  );

  const where: {
    orgId: string;
    requestedBy: string;
    status?: string;
  } = {
    orgId: auth.org.id,
    requestedBy: auth.ident.userId,
  };
  if (statusFilter) where.status = statusFilter;

  const intents = await prisma.actionIntent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      status: true,
      preview: true,
      approvedAt: true,
      executedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    items: intents.map((i) => ({
      id: i.id,
      action: i.action,
      status: i.status,
      preview: i.preview,
      approvedAt: i.approvedAt?.toISOString() ?? null,
      executedAt: i.executedAt?.toISOString() ?? null,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
    count: intents.length,
  });
}
