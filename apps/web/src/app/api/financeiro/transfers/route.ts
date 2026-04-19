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
import { requireElevation, ElevationRequiredError } from "@/lib/security/elevation";
import { validateChallengeToken, hashPayload } from "@/lib/security/challenge";
import { audit } from "@/lib/security/audit";
import { decryptSecret } from "@/lib/security/crypto";
import { RateLimits } from "@/lib/security/ratelimit";
import { AsaasError } from "@/lib/asaas/errors";
import { createTransfer, type CreateTransferInput } from "@/lib/asaas/transfers";
import { detectPixKeyType } from "@/lib/asaas/pix";
import {
  createDualApproval,
  hashApprovalPayload,
} from "@/lib/security/rbac/dualApproval";
import { sendEmail } from "@/lib/email/client";
import { DualApprovalRequestEmail } from "@/lib/email/templates/dual-approval-request";
import { emitDualApprovalNotifs } from "@/lib/financeiro/notifications";

const bodySchema = z.object({
  type: z.enum(["PIX", "TED"]),
  value: z.number().positive(),
  description: z.string().optional(),
  pixAddressKey: z.string().optional(),
  bankAccount: z
    .object({
      bankCode: z.string(),
      ownerName: z.string(),
      cpfCnpj: z.string(),
      agency: z.string(),
      account: z.string(),
      accountDigit: z.string(),
      accountType: z.enum(["CONTA_CORRENTE", "CONTA_POUPANCA"]).optional(),
    })
    .optional(),
});

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * POST /api/financeiro/transfers
 *
 * Exige:
 *  - permission TRANSFER_INIT
 *  - elevation TRANSFER ativa (cookie)
 *  - header X-Challenge-Token (OTP confirmado via email)
 *  - valor ≤ dualApprovalCap OU dualApprovalId (já aprovado)
 *
 * Se valor > dualApprovalCap: cria DualApproval + envia emails + retorna 202
 * com approvalId. Frontend deve aguardar aprovação antes de re-chamar com
 * approvalId.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.TRANSFER_INIT,
    });
    await requireElevation(ctx.userId, "TRANSFER");
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

  // Rate limit — máximo 5 transfers/hora/user
  const rl = await RateLimits.transfersPerUser(ctx.userId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: rl.reset },
      { status: 429 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // dualApprovalId opcional (passado na 2ª chamada após aprovação)
  const approvalId = req.headers.get("X-Dual-Approval-Id");

  // Challenge token (OTP confirmado) — obrigatório sempre
  const challengeToken = req.headers.get("X-Challenge-Token");
  if (!challengeToken) {
    return NextResponse.json(
      { error: "X-Challenge-Token header obrigatório" },
      { status: 400 }
    );
  }
  const payloadHash = hashPayload(parsed.data);
  const validToken = await validateChallengeToken(challengeToken, {
    userId: ctx.userId,
    kind: "TRANSFER",
    payloadHash,
  });
  if (!validToken.ok) {
    return NextResponse.json(
      { error: "CHALLENGE_INVALID", reason: validToken.reason },
      { status: 401 }
    );
  }

  // Load account + settings
  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: ctx.orgId },
  });
  if (!account || account.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Conta Asaas não aprovada" },
      { status: 422 }
    );
  }
  const settings = await prisma.orgFinancialSettings.findUnique({
    where: { orgId: ctx.orgId },
  });
  const dualCap = settings?.dualApprovalCapCents ?? 5_000_000;
  const hardCap = settings?.hardCapCents ?? 10_000_000;
  const valueCents = Math.round(parsed.data.value * 100);

  if (valueCents > hardCap) {
    return NextResponse.json(
      { error: "HARD_CAP_EXCEEDED", hardCapBrl: hardCap / 100 },
      { status: 422 }
    );
  }

  const requiresDualApproval = valueCents > dualCap;

  // Se exige dual approval e não veio approvalId → cria DualApproval + envia emails
  if (requiresDualApproval && !approvalId) {
    const approvalPayload = {
      type: parsed.data.type,
      value: parsed.data.value,
      description: parsed.data.description ?? null,
      pixAddressKey: parsed.data.pixAddressKey ?? null,
      bankAccount: parsed.data.bankAccount ?? null,
    };
    const approval = await createDualApproval({
      orgId: ctx.orgId,
      initiatedBy: ctx.userId,
      kind: "TRANSFER",
      payload: approvalPayload,
      amount: parsed.data.value,
      reason: parsed.data.description ?? null,
    });

    // Envia email para todos os admins/owner da org (exceto iniciador)
    const admins = await prisma.orgMembership.findMany({
      where: {
        orgId: ctx.orgId,
        role: { in: ["owner", "admin"] },
        userId: { not: ctx.userId },
      },
      include: { user: { select: { name: true, email: true } } },
    });
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const approvalUrl = `${baseUrl}/financeiro/dual-approvals/${approval.id}`;

    await Promise.all(
      admins.map((m) =>
        sendEmail({
          to: m.user.email,
          subject: `Aprovação dupla: transferência de ${fmtBRL(parsed.data.value)}`,
          react: DualApprovalRequestEmail({
            approverName: m.user.name ?? "Admin",
            initiatorName: ctx.userName,
            orgName: ctx.orgName,
            kind: "TRANSFER",
            amountBrl: fmtBRL(parsed.data.value),
            reason: parsed.data.description,
            approvalUrl,
            expiresAt: approval.expiresAt.toLocaleString("pt-BR"),
          }) as any,
        }).catch((err) =>
          console.error("[transfers] email approval falhou:", err)
        )
      )
    );

    // In-app notifications para os admins (aparecem no sino)
    emitDualApprovalNotifs({
      approvalId: approval.id,
      orgId: ctx.orgId,
      initiatorUserId: ctx.userId,
      kind: "TRANSFER",
      amount: parsed.data.value,
      initiatorName: ctx.userName,
    }).catch((err) => console.error("[transfers] notif dispatch falhou:", err));

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "DUAL_APPROVAL_CREATED",
        result: "SUCCESS",
        resourceType: "dual_approval",
        resource: `dual_approval:${approval.id}`,
        metadata: { kind: "TRANSFER", amount: parsed.data.value, adminsNotified: admins.length },
      }
    );

    return NextResponse.json(
      {
        status: "PENDING_APPROVAL",
        approvalId: approval.id,
        expiresAt: approval.expiresAt,
        adminsNotified: admins.length,
      },
      { status: 202 }
    );
  }

  // Se approvalId veio, valida que está aprovada + hash bate + não expirou
  if (requiresDualApproval && approvalId) {
    const approval = await prisma.dualApproval.findUnique({
      where: { id: approvalId },
    });
    if (!approval || approval.orgId !== ctx.orgId) {
      return NextResponse.json({ error: "Approval não encontrada" }, { status: 404 });
    }
    if (approval.status !== "APPROVED") {
      return NextResponse.json(
        { error: "APPROVAL_NOT_APPROVED", status: approval.status },
        { status: 422 }
      );
    }
    if (approval.executedAt) {
      return NextResponse.json(
        { error: "APPROVAL_ALREADY_EXECUTED" },
        { status: 409 }
      );
    }
    // Re-verifica payload hash
    const currentHash = hashApprovalPayload({
      type: parsed.data.type,
      value: parsed.data.value,
      description: parsed.data.description ?? null,
      pixAddressKey: parsed.data.pixAddressKey ?? null,
      bankAccount: parsed.data.bankAccount ?? null,
    });
    if (currentHash !== approval.payloadHash) {
      return NextResponse.json(
        { error: "PAYLOAD_TAMPERED" },
        { status: 409 }
      );
    }
  }

  // Execute transfer
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  const transferInput: CreateTransferInput = {
    value: parsed.data.value,
    description: parsed.data.description,
  };
  if (parsed.data.type === "PIX") {
    transferInput.pixAddressKey = parsed.data.pixAddressKey;
    const kt = detectPixKeyType(parsed.data.pixAddressKey!);
    if (kt && kt !== "PHONE") {
      transferInput.pixAddressKeyType = kt === "EVP" ? "EVP" : (kt as any);
    }
  } else if (parsed.data.type === "TED" && parsed.data.bankAccount) {
    transferInput.bankAccount = {
      bank: { code: parsed.data.bankAccount.bankCode },
      ownerName: parsed.data.bankAccount.ownerName,
      cpfCnpj: parsed.data.bankAccount.cpfCnpj.replace(/\D/g, ""),
      agency: parsed.data.bankAccount.agency,
      account: parsed.data.bankAccount.account,
      accountDigit: parsed.data.bankAccount.accountDigit,
      bankAccountType: parsed.data.bankAccount.accountType ?? "CONTA_CORRENTE",
    };
  }

  try {
    const asaas = await createTransfer({ input: transferInput, apiKey });

    // Persist local
    const local = await prisma.asaasTransfer.create({
      data: {
        orgId: ctx.orgId,
        asaasTransferId: asaas.id,
        value: asaas.value,
        netValue: asaas.netValue ?? null,
        transferFee: asaas.transferFee ?? null,
        type: parsed.data.type,
        status: asaas.status,
        pixAddressKey: parsed.data.pixAddressKey ?? null,
        pixKeyType:
          parsed.data.type === "PIX" && parsed.data.pixAddressKey
            ? detectPixKeyType(parsed.data.pixAddressKey)
            : null,
        bankAccountJson: parsed.data.bankAccount as any,
        requestedBy: ctx.userId,
        description: parsed.data.description ?? null,
        scheduledDate: asaas.scheduledDate ? new Date(asaas.scheduledDate) : null,
      },
    });

    // Mark approval executed
    if (approvalId) {
      await prisma.dualApproval.update({
        where: { id: approvalId },
        data: { executedAt: new Date() },
      });
    }

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "TRANSFER_CONFIRM",
        result: "SUCCESS",
        resourceType: "asaas_transfer",
        resource: `asaas_transfer:${local.id}`,
        metadata: {
          type: parsed.data.type,
          value: parsed.data.value,
          asaasTransferId: asaas.id,
          approvalId: approvalId ?? null,
        },
      }
    );

    return NextResponse.json({
      transfer: {
        id: local.id,
        asaasTransferId: asaas.id,
        status: asaas.status,
        value: asaas.value,
        netValue: asaas.netValue,
        transferFee: asaas.transferFee,
        type: local.type,
        scheduledDate: asaas.scheduledDate,
      },
    });
  } catch (err) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "TRANSFER_CONFIRM",
        result: "FAILURE",
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      }
    );
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors },
        { status: 422 }
      );
    }
    throw err;
  }
}

/**
 * GET /api/financeiro/transfers — histórico.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const transfers = await prisma.asaasTransfer.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ transfers });
}
