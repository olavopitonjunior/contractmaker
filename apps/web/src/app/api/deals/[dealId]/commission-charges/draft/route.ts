import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rascunho do ChargeWizard. State é JSON livre (forma fluida do wizard
 * acompanha mudanças sem migration). Cleanup via cron quando expiresAt < now.
 */

const upsertSchema = z.object({
  state: z.record(z.unknown()), // payload livre do wizard
});

async function authorize(req: NextRequest, dealId: string) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return { error: authResult.response };
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CHARGE_CREATE_FROM_DEAL,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return {
        error: NextResponse.json({ error: err.code }, { status: err.status }),
      };
    }
    throw err;
  }

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId: ctx.orgId } },
    select: { id: true, userId: true },
  });
  if (!deal) {
    return {
      error: NextResponse.json({ error: "Deal não encontrado" }, { status: 404 }),
    };
  }

  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (membership?.role === "sales" && deal.userId !== ctx.userId) {
    return {
      error: NextResponse.json({ error: "Deal não encontrado" }, { status: 404 }),
    };
  }

  return { ctx, deal };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const auth = await authorize(req, dealId);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const draft = await prisma.commissionChargeDraft.findFirst({
    where: { dealId, userId: ctx.userId },
  });
  if (!draft) return NextResponse.json({ draft: null });
  if (draft.expiresAt.getTime() < Date.now()) {
    await prisma.commissionChargeDraft.delete({ where: { id: draft.id } }).catch(() => {});
    return NextResponse.json({ draft: null });
  }
  return NextResponse.json({
    draft: {
      id: draft.id,
      state: draft.state,
      updatedAt: draft.updatedAt,
      expiresAt: draft.expiresAt,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const auth = await authorize(req, dealId);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const raw = await req.json().catch(() => ({}));
  const parsed = upsertSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const upserted = await prisma.commissionChargeDraft.upsert({
    where: { dealId_userId: { dealId, userId: ctx.userId } },
    create: {
      orgId: ctx.orgId,
      dealId,
      userId: ctx.userId,
      state: parsed.data.state as Prisma.InputJsonValue,
      expiresAt,
    },
    update: {
      state: parsed.data.state as Prisma.InputJsonValue,
      expiresAt,
    },
  });

  return NextResponse.json({
    draft: { id: upserted.id, updatedAt: upserted.updatedAt, expiresAt: upserted.expiresAt },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const auth = await authorize(req, dealId);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  await prisma.commissionChargeDraft
    .delete({ where: { dealId_userId: { dealId, userId: ctx.userId } } })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
