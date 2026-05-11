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
import { audit } from "@/lib/security/audit";

const patchSchema = z.object({
  label: z.string().min(2).max(80).optional(),
});

/**
 * PATCH /api/financeiro/accounts/[id] — edita label.
 */
export async function PATCH(
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
      permission: PERMISSION.ACCOUNT_PERMISSIONS_MANAGE,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const account = await prisma.asaasAccount.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const updated = await prisma.asaasAccount.update({
    where: { id },
    data: parsed.data,
  });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "ACCOUNT_LABEL_UPDATE",
      result: "SUCCESS",
      resourceType: "asaas_account",
      resource: `asaas_account:${id}`,
      metadata: { label: parsed.data.label ?? null },
    }
  );

  return NextResponse.json({
    id: updated.id,
    label: updated.label,
  });
}

/**
 * DELETE /api/financeiro/accounts/[id] — soft delete (archive).
 * Bloqueia se a conta é a ativa OU se há cobrança PENDING/OVERDUE.
 */
export async function DELETE(
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
      permission: PERMISSION.ACCOUNT_ARCHIVE,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const account = await prisma.asaasAccount.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { activeAsaasAccountId: true },
  });
  if (org?.activeAsaasAccountId === id) {
    return NextResponse.json(
      {
        error: "Conta atualmente ativa — selecione outra antes de arquivar",
        code: "ACCOUNT_IS_ACTIVE",
      },
      { status: 409 }
    );
  }

  const openCharges = await prisma.commissionCharge.count({
    where: {
      accountId: id,
      status: { in: ["PENDING", "OVERDUE"] },
      cancelledAt: null,
    },
  });
  if (openCharges > 0) {
    return NextResponse.json(
      {
        error: "Existem cobranças em aberto vinculadas a essa conta",
        code: "ACCOUNT_HAS_OPEN_CHARGES",
        openChargesCount: openCharges,
      },
      { status: 409 }
    );
  }

  await prisma.asaasAccount.update({
    where: { id },
    data: { archivedAt: new Date() },
  });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "ACCOUNT_ARCHIVE",
      result: "SUCCESS",
      resourceType: "asaas_account",
      resource: `asaas_account:${id}`,
    }
  );

  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
