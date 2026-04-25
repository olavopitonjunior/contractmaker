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
import { decryptSecret } from "@/lib/security/crypto";
import { confirmSandboxPayment } from "@/lib/asaas/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/sandbox/confirm-payment
 *
 * Endpoint utilitário para QA (Claude Chrome / scripts E2E) confirmar uma
 * cobrança sandbox sem depender do MCP Asaas externo. Dispara webhook
 * PAYMENT_CONFIRMED → PAYMENT_RECEIVED na Asaas, que por sua vez aciona
 * o splitDispatcher (Fase 6) localmente.
 *
 * **Hard-stop em produção** — recusa se ASAAS_ENV=production. Mesmo se
 * env mudar futuramente, este endpoint nunca dispara em prod real.
 *
 * Body: `{ asaasPaymentId: string }` (formato `pay_xxxxx`).
 */
const bodySchema = z.object({
  asaasPaymentId: z.string().trim().min(3),
});

export async function POST(req: NextRequest) {
  if (process.env.ASAAS_ENV === "production") {
    return NextResponse.json(
      {
        error: "ENDPOINT_DISABLED_IN_PRODUCTION",
        message: "Sandbox confirm payment endpoint não disponível em produção real",
      },
      { status: 403 }
    );
  }

  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: ctx.orgId },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Subconta Asaas não encontrada para esta org" },
      { status: 422 }
    );
  }

  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  let asaasResponse: unknown;
  try {
    asaasResponse = await confirmSandboxPayment(parsed.data.asaasPaymentId, apiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "SANDBOX_PAYMENT_CONFIRMED",
        result: "FAILURE",
        resourceType: "asaas_payment",
        resource: `asaas_payment:${parsed.data.asaasPaymentId}`,
        metadata: { reason: message.slice(0, 500) },
      }
    );
    return NextResponse.json(
      { error: "ASAAS_CONFIRM_FAILED", message },
      { status: 422 }
    );
  }

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "SANDBOX_PAYMENT_CONFIRMED",
      result: "SUCCESS",
      resourceType: "asaas_payment",
      resource: `asaas_payment:${parsed.data.asaasPaymentId}`,
    }
  );

  return NextResponse.json({
    ok: true,
    asaasPaymentId: parsed.data.asaasPaymentId,
    asaasResponse,
  });
}
