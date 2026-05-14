import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/financeiro/accounts/[id]/kyc-token
 *
 * Gera (ou regenera) o token público da rota /kyc/[token] hospedada.
 * Útil quando:
 *  - Conta legada não tem token ainda
 *  - Admin suspeita que o link vazou e quer invalidar o anterior
 *
 * Owner-only (ACCOUNT_CREATE). Audit log registra rotação.
 */
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
      permission: PERMISSION.ACCOUNT_CREATE,
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
    select: { id: true, kycToken: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const newToken = randomBytes(32).toString("hex");
  await prisma.asaasAccount.update({
    where: { id },
    data: { kycToken: newToken },
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
      metadata: {
        field: "kycToken",
        rotated: account.kycToken !== null,
      },
    }
  );

  return NextResponse.json({ ok: true, kycToken: newToken });
}

export const runtime = "nodejs";
