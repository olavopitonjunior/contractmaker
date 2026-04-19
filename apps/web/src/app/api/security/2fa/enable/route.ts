import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import {
  decryptTotpSecret,
  verifyTotpCode,
  generateRecoveryCodes,
} from "@/lib/security/totp";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/security/2fa/enable
 * Body: { code: "123456" }
 * Confirma o primeiro código TOTP + ativa 2FA + gera recovery codes.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = body.code?.replace(/\s/g, "") ?? "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: "Código inválido (esperado 6 dígitos)" },
      { status: 400 }
    );
  }

  const row = await prisma.twoFactorSecret.findUnique({
    where: { userId: ctx.userId },
  });
  if (!row) {
    return NextResponse.json(
      { error: "Setup não iniciado — chame /setup primeiro" },
      { status: 400 }
    );
  }
  if (row.enabled) {
    return NextResponse.json({ error: "2FA já está ativo" }, { status: 409 });
  }

  const secret = decryptTotpSecret({
    ciphertext: row.secretEncrypted,
    iv: row.secretIvBase64,
    tag: row.secretTagBase64,
  });

  if (!verifyTotpCode(secret, code)) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      { action: "2FA_ENABLE", result: "FAILURE", metadata: { reason: "wrong_code" } }
    );
    return NextResponse.json({ error: "Código incorreto" }, { status: 401 });
  }

  const recovery = await generateRecoveryCodes();
  await prisma.twoFactorSecret.update({
    where: { userId: ctx.userId },
    data: {
      enabled: true,
      enrolledAt: new Date(),
      recoveryCodesEnc: recovery.hashedJson,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    { action: "2FA_ENABLE", result: "SUCCESS" }
  );

  return NextResponse.json({
    enabled: true,
    recoveryCodes: recovery.plaintext,
  });
}
