import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

const bodySchema = z.object({
  notes: z.string().max(200).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.RECONCILIATION_MATCH,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const recon = await prisma.bankReconciliation.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!recon) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

  const updated = await prisma.bankReconciliation.update({
    where: { id: recon.id },
    data: {
      status: "ignored",
      notes: parsed.data.notes ?? null,
      matchedBy: ctx.userId,
      matchedAt: new Date(),
    },
  });

  return NextResponse.json({ reconciliation: updated });
}
