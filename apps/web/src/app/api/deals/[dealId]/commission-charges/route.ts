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
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { RateLimits } from "@/lib/security/ratelimit";
import {
  runCreateCommissionCharge,
  buildChargePreview,
} from "@/lib/asaas/charges-action";
import { requireApproval, approvalResponse } from "@/lib/api/intents";

const createSchema = z.object({
  billingType: z.enum(["PIX", "BOLETO"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contractId: z.string().optional(),
  description: z.string().optional(),
});

/**
 * POST /api/deals/[dealId]/commission-charges
 *
 * Cria cobrança de comissão. Session humana → executa direto. Bearer →
 * cria ActionIntent (CHARGE_CREATE) com preview, retorna 202.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireAuth(req, { scope: "charges:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { dealId } = await params;

  // 1. Permission
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CHARGE_CREATE_FROM_DEAL,
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

  // 2. Rate limit
  const rl = await RateLimits.chargesPerOrg(ctx.orgId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: rl.reset },
      { status: 429 }
    );
  }

  // 3. Body
  const raw = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // 4. Sales-scope guard (deal precisa pertencer ao user se role=sales)
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId: ctx.orgId } },
    select: { id: true, userId: true, title: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (membership?.role === "sales" && deal.userId !== ctx.userId) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  // 5. Bearer → cria intent. Session → executa direto.
  const { billingType, dueDate, contractId, description } = parsed.data;
  const idempotencyKey = req.headers.get("x-idempotency-key");

  // Pra Bearer, build preview SEM chamar Asaas
  if (ctx.via === "bearer") {
    const preview = await buildChargePreview({
      dealId,
      orgId: ctx.orgId,
      contractId,
      billingType,
      dueDate,
    });
    if ("error" in preview) {
      return NextResponse.json(
        { error: preview.error },
        { status: preview.status }
      );
    }

    const result = await requireApproval<unknown>({
      ctx: {
        via: ctx.via,
        userId: ctx.userId,
        orgId: ctx.orgId,
        actor: ctx.actor,
      },
      action: "CHARGE_CREATE",
      payload: { dealId, billingType, dueDate, contractId, description },
      preview: {
        summary: preview.summary,
        details: preview.details as unknown as Record<string, unknown>,
      },
      req,
      idempotencyKey,
      run: async () => {
        const out = await runCreateCommissionCharge({
          dealId,
          orgId: ctx.orgId,
          userId: ctx.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          billingType,
          dueDate,
          contractId,
          description,
          skipAudit: true, // auditamos abaixo com via=newton
        });

        if (out.status >= 200 && out.status < 300) {
          await audit(
            {
              orgId: ctx.orgId,
              userId: ctx.userId,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
            {
              action: "CHARGE_CREATE",
              result: "SUCCESS",
              resourceType: "commission_charge",
              resource: `commission_charge:${(out.body.charge as { id: string } | undefined)?.id ?? "unknown"}`,
              metadata: mergeAuditMetadata(
                { dealId, billingType, dueDate },
                ctx.actor
              ),
            }
          );
        }
        return out;
      },
    });
    return approvalResponse(result);
  }

  // Session: executa direto
  const out = await runCreateCommissionCharge({
    dealId,
    orgId: ctx.orgId,
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    billingType,
    dueDate,
    contractId,
    description,
  });
  return NextResponse.json(out.body, { status: out.status });
}

/**
 * GET /api/deals/[dealId]/commission-charges — lista do deal.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireAuth(req, { scope: "charges:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { dealId } = await params;

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId: ctx.orgId } },
    select: { id: true, userId: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (membership?.role === "sales" && deal.userId !== ctx.userId) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  const charges = await prisma.commissionCharge.findMany({
    where: { dealId, orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true, cpfCnpj: true, email: true } },
    },
  });

  return NextResponse.json({
    charges: charges.map((c) => ({
      id: c.id,
      asaasPaymentId: c.asaasPaymentId,
      value: c.value,
      netValue: c.netValue,
      billingType: c.billingType,
      status: c.status,
      asaasStatus: c.asaasStatus,
      description: c.description,
      originalDueDate: c.originalDueDate,
      currentDueDate: c.currentDueDate,
      paidAt: c.paidAt,
      cancelledAt: c.cancelledAt,
      refundedAt: c.refundedAt,
      invoiceUrl: c.invoiceUrl,
      bankSlipUrl: c.bankSlipUrl,
      identificationField: c.identificationField,
      pixQrCodePayload: c.pixQrCodePayload,
      pixQrCodeImage: c.pixQrCodeImage,
      customer: c.customer,
      createdAt: c.createdAt,
    })),
  });
}

export const runtime = "nodejs";
export const maxDuration = 30;
