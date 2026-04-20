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
import { decryptSecret } from "@/lib/security/crypto";
import { listFinancialTransactions } from "@/lib/asaas/finance";
import { AsaasError } from "@/lib/asaas/errors";

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  finishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const dynamic = "force-dynamic";

/**
 * GET /api/financeiro/statement — extrato Asaas (financial transactions).
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.FINANCE_STATEMENT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Query inválida" }, { status: 400 });

  const account = await prisma.asaasAccount.findUnique({ where: { orgId: ctx.orgId } });
  if (!account || account.status !== "APPROVED") {
    return NextResponse.json({
      hasMore: false,
      totalCount: 0,
      limit: 0,
      offset: 0,
      data: [],
      accountStatus: account?.status ?? "NOT_STARTED",
    });
  }

  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    const res = await listFinancialTransactions({
      apiKey,
      query: {
        startDate: parsed.data.startDate,
        finishDate: parsed.data.finishDate,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
        order: "desc",
      },
    });

    // Totals
    let totalIn = 0;
    let totalOut = 0;
    for (const t of res.data) {
      if (t.value > 0) totalIn += t.value;
      else totalOut += Math.abs(t.value);
    }

    return NextResponse.json({
      hasMore: res.hasMore,
      totalCount: res.totalCount,
      limit: res.limit,
      offset: res.offset,
      totalIn,
      totalOut,
      data: res.data,
    });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors, data: [] },
        { status: 422 }
      );
    }
    console.error("[statement]", err);
    return NextResponse.json({ error: "Falha ao obter extrato", data: [] }, { status: 500 });
  }
}
