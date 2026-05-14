import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getAccountWithApiKey } from "@/lib/asaas/account";
import { asaasFetch } from "@/lib/asaas/client";

/**
 * DEBUG endpoint — owner-only. Retorna o payload BRUTO de /myAccount/documents
 * pra inspecionar campos retornados pelo Asaas (especificamente verificar se
 * onboardingUrl está presente). Remover/proteger antes de prod final.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { accountId } = await params;

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
    where: { id: accountId, orgId: ctx.orgId },
    select: { id: true, asaasId: true, status: true },
  });
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { apiKey } = await getAccountWithApiKey(account.id);
  const raw = await asaasFetch<unknown>("/myAccount/documents", { apiKey });

  return NextResponse.json({
    accountId: account.id,
    asaasId: account.asaasId,
    status: account.status,
    rawAsaasResponse: raw,
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
