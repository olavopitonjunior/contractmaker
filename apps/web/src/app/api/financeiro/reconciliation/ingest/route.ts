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
import { ingestFinancialTransactions } from "@/lib/asaas/reconciliation";
import { AsaasError } from "@/lib/asaas/errors";

const bodySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  finishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

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

  const account = await prisma.asaasAccount.findUnique({ where: { orgId: ctx.orgId } });
  if (!account || account.status !== "APPROVED") {
    return NextResponse.json({ error: "Conta Asaas não aprovada" }, { status: 422 });
  }

  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    const result = await ingestFinancialTransactions({
      orgId: ctx.orgId,
      apiKey,
      startDate: parsed.data.startDate,
      finishDate: parsed.data.finishDate,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json({ error: "ASAAS_ERROR", details: err.errors }, { status: 422 });
    }
    throw err;
  }
}
