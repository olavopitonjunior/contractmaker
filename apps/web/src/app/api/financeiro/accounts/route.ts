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
import { AsaasError } from "@/lib/asaas/errors";
import { createAsaasAccount } from "@/lib/asaas/account-create";
import {
  listAccessibleAccounts,
  maskWalletId,
} from "@/lib/asaas/account";

/**
 * GET /api/financeiro/accounts — lista contas Asaas acessíveis ao user.
 * Owner: todas não-arquivadas. Non-owner: contas com ≥1 grant.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const accounts = await listAccessibleAccounts(ctx.userId, ctx.orgId);
  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { activeAsaasAccountId: true },
  });

  // Counts agregados — útil pra UI mostrar utilização
  const counts = await prisma.commissionCharge.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _count: true,
  });
  const countByAccount = new Map(
    counts.map((c) => [c.accountId ?? "", c._count])
  );

  return NextResponse.json({
    activeAccountId: org?.activeAsaasAccountId ?? null,
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      asaasId: a.asaasId,
      walletIdMasked: maskWalletId(a.walletId),
      personType: a.personType,
      status: a.status,
      generalStatus: a.generalStatus,
      documentationStatus: a.documentationStatus,
      commercialInfoStatus: a.commercialInfoStatus,
      bankAccountInfoStatus: a.bankAccountInfoStatus,
      accountNumber: a.accountNumber,
      approvedAt: a.approvedAt,
      archivedAt: a.archivedAt,
      isActive: a.id === org?.activeAsaasAccountId,
      chargesCount: countByAccount.get(a.id) ?? 0,
      createdAt: a.createdAt,
    })),
  });
}

const createSchema = z.object({
  personType: z.enum(["PHYSICAL", "LEGAL"]),
  label: z.string().min(2).max(80).optional(),
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
  birthDate: z.string().optional(),
  companyType: z.enum(["MEI", "LIMITED", "INDIVIDUAL", "ASSOCIATION"]).optional(),
  phone: z.string().optional(),
  site: z.string().optional(),
  /** Quando true (default false), define a recém-criada como ativa da org. */
  setActive: z.boolean().optional(),
});

/**
 * POST /api/financeiro/accounts — cria nova subconta Asaas.
 * Diferente do legado /onboarding/subaccount: NÃO bloqueia se já existem contas.
 * Requer permissão ACCOUNT_CREATE (owner-only por padrão).
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

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

  const raw = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
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
    });

    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "ACCOUNT_CREATE",
        result: "SUCCESS",
        resourceType: "asaas_account",
        resource: `asaas_account:${result.accountId}`,
        metadata: {
          asaasId: result.asaasId,
          walletId: result.walletId,
          personType: parsed.data.personType,
          label: parsed.data.label ?? null,
          setActive: parsed.data.setActive ?? false,
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
        action: "ACCOUNT_CREATE",
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
    console.error("[accounts/POST]", err);
    return NextResponse.json(
      {
        error: "Falha ao criar subconta",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
