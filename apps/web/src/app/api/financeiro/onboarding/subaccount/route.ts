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
import {
  requireElevation,
  ElevationRequiredError,
} from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";
import { AsaasError } from "@/lib/asaas/errors";
import { createAsaasAccount } from "@/lib/asaas/account-create";

const subaccountSchema = z.object({
  personType: z.enum(["PHYSICAL", "LEGAL"]),
  name: z.string().min(2),
  email: z.string().email(),
  cpfCnpj: z.string().min(11),
  mobilePhone: z.string().min(10),
  incomeValue: z.number().positive(),
  postalCode: z.string().min(8),
  address: z.string().min(2),
  addressNumber: z.string().min(1),
  complement: z.string().optional(),
  province: z.string().min(2),
  birthDate: z.string().optional(), // PF only, YYYY-MM-DD
  companyType: z.enum(["MEI", "LIMITED", "INDIVIDUAL", "ASSOCIATION"]).optional(), // PJ only
  phone: z.string().optional(),
  site: z.string().optional(),
});

/**
 * POST /api/financeiro/onboarding/subaccount
 *
 * Bootstrap legado: cria a primeira subconta Asaas pra org. Mantido só pra
 * compatibilidade com o OnboardingWizard original em /financeiro/onboarding.
 * Novas contas adicionais devem usar POST /api/financeiro/accounts (suporta N).
 *
 * Se já existe ≥1 conta, retorna 409 com instrução pra usar o novo endpoint.
 * Exige permission KYC_SUBMIT + elevation KYC_EDIT (regras antigas mantidas).
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.KYC_SUBMIT,
    });
    await requireElevation(ctx.userId, "KYC_EDIT");
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError ||
      err instanceof ElevationRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  // Guard de bootstrap: este endpoint só serve quando a org ainda não tem
  // nenhuma conta. Pra criar contas adicionais, usar POST /accounts (multi).
  const existingCount = await prisma.asaasAccount.count({
    where: { orgId: ctx.orgId },
  });
  if (existingCount > 0) {
    return NextResponse.json(
      {
        error: "Org já tem conta Asaas",
        code: "USE_NEW_ACCOUNTS_ENDPOINT",
        message:
          "Use POST /api/financeiro/accounts para criar contas adicionais.",
      },
      { status: 409 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = subaccountSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  try {
    const result = await createAsaasAccount({
      orgId: ctx.orgId,
      ...parsed.data,
      // Bootstrap: a primeira conta criada vira automaticamente a ativa.
      setActive: true,
    });

    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "KYC_SUBMIT",
        result: "SUCCESS",
        resourceType: "asaas_account",
        resource: `asaas_account:${result.accountId}`,
        metadata: {
          asaasId: result.asaasId,
          walletId: result.walletId,
          personType: parsed.data.personType,
        },
      }
    );

    return NextResponse.json(result);
  } catch (err) {
    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "KYC_SUBMIT",
        result: "FAILURE",
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      }
    );

    if (err instanceof AsaasError) {
      return NextResponse.json(
        {
          error: "ASAAS_ERROR",
          status: err.status,
          details: err.errors,
        },
        { status: err.status === 401 ? 500 : 422 }
      );
    }
    console.error("[onboarding/subaccount]", err);
    return NextResponse.json(
      { error: "Falha ao criar subconta", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
