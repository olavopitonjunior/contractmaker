import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { resendActivationLink } from "@/lib/asaas/kyc";
import { AsaasError } from "@/lib/asaas/errors";

/**
 * POST /api/financeiro/accounts/[id]/resend-activation-link
 *
 * Reenvia o email de ativação da subconta Asaas pro email cadastrado do
 * titular (loginEmail). É a forma do titular acessar o painel Asaas e
 * concluir o KYC com os documentos pessoais dele.
 *
 * Asaas envia o primeiro link automaticamente quando a subconta é criada.
 * Este endpoint dispara um RE-envio — limitado a 1 vez na vida da subconta
 * pela própria Asaas (400 invalid_action no segundo).
 *
 * Owner-only (ACCOUNT_CREATE). Sem elevation — é só email transactional.
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
    select: { id: true, asaasId: true, kyc: true, status: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Conta não encontrada" },
      { status: 404 }
    );
  }
  if (account.status === "APPROVED") {
    return NextResponse.json(
      { error: "Conta já aprovada — reenvio desnecessário" },
      { status: 422 }
    );
  }

  const kycEmail =
    (account.kyc as { email?: string } | null)?.email ?? null;

  try {
    await resendActivationLink({ asaasAccountId: account.asaasId });
  } catch (err) {
    const isAlreadyResent =
      err instanceof AsaasError &&
      err.status === 400 &&
      (err.errors?.[0]?.code === "invalid_action" ||
        (err.errors?.[0]?.description ?? "")
          .toLowerCase()
          .includes("já foi reenviado"));

    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "ACCOUNT_ACTIVATION_LINK_RESENT",
        result: "FAILURE",
        resourceType: "asaas_account",
        resource: `asaas_account:${id}`,
        metadata: {
          asaasId: account.asaasId,
          email: kycEmail,
          alreadyResent: isAlreadyResent,
          message:
            err instanceof AsaasError
              ? err.errors?.[0]?.description ?? err.message
              : err instanceof Error
                ? err.message
                : String(err),
        },
      }
    );

    if (isAlreadyResent) {
      return NextResponse.json(
        {
          error: "ALREADY_RESENT",
          message:
            "A Asaas só permite UM reenvio por subconta — o link já foi reenviado anteriormente. Peça pro titular procurar o email original (verificar caixa de spam) ou abrir o portal em https://app.asaas.com e usar 'Esqueci minha senha'.",
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      {
        error: "ASAAS_ERROR",
        message:
          err instanceof AsaasError
            ? err.errors?.[0]?.description ?? err.message
            : "Falha ao acionar Asaas",
      },
      { status: 502 }
    );
  }

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "ACCOUNT_ACTIVATION_LINK_RESENT",
      result: "SUCCESS",
      resourceType: "asaas_account",
      resource: `asaas_account:${id}`,
      metadata: { asaasId: account.asaasId, email: kycEmail },
    }
  );

  return NextResponse.json({ ok: true, email: kycEmail });
}

export const runtime = "nodejs";
