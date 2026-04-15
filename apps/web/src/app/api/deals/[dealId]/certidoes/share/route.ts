import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const DEFAULT_EXPIRY_DAYS = 7;

/**
 * POST /api/deals/:dealId/certidoes/share
 * Body: { expiryDays?: number } (default 7, max 30)
 *
 * Creates or returns an active share link for the deal's certidões.
 * If an active (non-revoked, non-expired) link already exists, returns it
 * instead of creating a new one — only one active link per deal at a time.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: { form: { select: { orgId: true } } },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const expiryDays = Math.min(
    Math.max(Number(body.expiryDays ?? DEFAULT_EXPIRY_DAYS), 1),
    30
  );

  // Reuse active link if exists
  const now = new Date();
  const active = await prisma.certidoesShareLink.findFirst({
    where: {
      dealId: params.dealId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
  if (active) {
    return NextResponse.json({
      token: active.token,
      url: `/s/certidoes/${active.token}`,
      expiresAt: active.expiresAt,
      viewCount: active.viewCount,
      reused: true,
    });
  }

  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const link = await prisma.certidoesShareLink.create({
    data: {
      dealId: params.dealId,
      createdBy: session.user.id,
      expiresAt,
    },
  });

  return NextResponse.json({
    token: link.token,
    url: `/s/certidoes/${link.token}`,
    expiresAt: link.expiresAt,
    viewCount: 0,
    reused: false,
  });
}

/**
 * GET /api/deals/:dealId/certidoes/share
 * Returns the currently active link for the deal, if any.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: { form: { select: { orgId: true } } },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const active = await prisma.certidoesShareLink.findFirst({
    where: {
      dealId: params.dealId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!active) {
    return NextResponse.json({ link: null });
  }
  return NextResponse.json({
    link: {
      token: active.token,
      url: `/s/certidoes/${active.token}`,
      expiresAt: active.expiresAt,
      viewCount: active.viewCount,
    },
  });
}
