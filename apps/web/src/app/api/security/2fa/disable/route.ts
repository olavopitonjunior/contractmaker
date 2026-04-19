import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/auth/context";
import {
  decryptTotpSecret,
  verifyTotpCode,
} from "@/lib/security/totp";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/security/2fa/disable
 * Body: { password: "...", code: "123456" }
 * Exige senha + TOTP atual para desativar.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const body = (await req.json().catch(() => ({}))) as {
    password?: string;
    code?: string;
  };
  if (!body.password || !body.code) {
    return NextResponse.json(
      { error: "password e code são obrigatórios" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Senha não definida" }, { status: 400 });
  }
  const passwordOk = await bcrypt.compare(body.password, user.passwordHash);
  if (!passwordOk) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      { action: "2FA_DISABLE", result: "FAILURE", metadata: { reason: "wrong_password" } }
    );
    return NextResponse.json({ error: "Senha incorreta" }, { status: 401 });
  }

  const row = await prisma.twoFactorSecret.findUnique({
    where: { userId: ctx.userId },
  });
  if (!row?.enabled) {
    return NextResponse.json({ error: "2FA não está ativo" }, { status: 400 });
  }

  const secret = decryptTotpSecret({
    ciphertext: row.secretEncrypted,
    iv: row.secretIvBase64,
    tag: row.secretTagBase64,
  });
  if (!verifyTotpCode(secret, body.code)) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      { action: "2FA_DISABLE", result: "FAILURE", metadata: { reason: "wrong_code" } }
    );
    return NextResponse.json({ error: "Código TOTP incorreto" }, { status: 401 });
  }

  await prisma.twoFactorSecret.delete({ where: { userId: ctx.userId } });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    { action: "2FA_DISABLE", result: "SUCCESS" }
  );

  return NextResponse.json({ enabled: false });
}
