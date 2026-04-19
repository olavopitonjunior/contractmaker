import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  decryptTotpSecret,
  verifyTotpCode,
  verifyRecoveryCode,
} from "@/lib/security/totp";
import {
  createElevation,
  readElevation,
  revokeElevation,
  ElevationScope,
} from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";
import { RateLimits } from "@/lib/security/ratelimit";

const ELEVATION_SCOPES = [
  "TRANSFER",
  "KYC_EDIT",
  "BANK_ACCOUNT",
  "API_KEY_ROTATE",
  "MEMBER_MANAGE",
  "FEES_CONFIG",
] as const satisfies readonly ElevationScope[];

const bodySchema = z.object({
  password: z.string().min(1),
  code: z.string().optional(),
  recoveryCode: z.string().optional(),
  scopes: z.array(z.enum(ELEVATION_SCOPES)).min(1),
});

/**
 * POST /api/security/elevation
 * Body: { password, code (TOTP) OR recoveryCode, scopes[] }
 * Retorna elevation token (via cookie) válido por 15min.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  // Rate limit de tentativas falhas
  const rl = await RateLimits.elevationFailuresPerUser(ctx.userId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente em alguns minutos.", retryAfter: rl.reset },
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
  const { password, code, recoveryCode, scopes } = parsed.data;

  // 1) Verifica senha
  const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Senha não definida" }, { status: 400 });
  }
  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "LOGIN_ELEVATION_FAILED",
        result: "DENIED",
        metadata: { reason: "wrong_password", scopes },
      }
    );
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  // 2) Verifica 2FA — obrigatório se o user tiver 2FA ativo
  const twofa = await prisma.twoFactorSecret.findUnique({
    where: { userId: ctx.userId },
  });

  if (twofa?.enabled) {
    if (!code && !recoveryCode) {
      return NextResponse.json(
        { error: "2FA ativo — informe code ou recoveryCode" },
        { status: 401 }
      );
    }

    let verified = false;

    if (code) {
      const secret = decryptTotpSecret({
        ciphertext: twofa.secretEncrypted,
        iv: twofa.secretIvBase64,
        tag: twofa.secretTagBase64,
      });
      verified = verifyTotpCode(secret, code);
    } else if (recoveryCode) {
      const result = await verifyRecoveryCode(twofa.recoveryCodesEnc, recoveryCode);
      if (result.valid) {
        verified = true;
        await prisma.twoFactorSecret.update({
          where: { userId: ctx.userId },
          data: { recoveryCodesEnc: result.remainingJson },
        });
        await audit(
          { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
          { action: "2FA_RECOVERY_USED", result: "SUCCESS" }
        );
      }
    }

    if (!verified) {
      await audit(
        { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
        {
          action: "LOGIN_ELEVATION_FAILED",
          result: "DENIED",
          metadata: { reason: "wrong_2fa", scopes },
        }
      );
      return NextResponse.json(
        { error: "Código 2FA incorreto" },
        { status: 401 }
      );
    }

    // Atualiza lastUsedAt
    await prisma.twoFactorSecret.update({
      where: { userId: ctx.userId },
      data: { lastUsedAt: new Date() },
    });
  }

  // 3) Cria elevation
  const { expiresAt } = await createElevation({
    userId: ctx.userId,
    scopes: scopes as ElevationScope[],
    ip: ctx.ipAddress,
    ua: ctx.userAgent,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "LOGIN_ELEVATED",
      result: "SUCCESS",
      metadata: { scopes },
    }
  );

  return NextResponse.json({ elevated: true, scopes, expiresAt });
}

/**
 * GET /api/security/elevation — status atual da elevation.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const payload = await readElevation();
  if (!payload || payload.userId !== ctx.userId) {
    return NextResponse.json({ elevated: false, scopes: [] });
  }
  return NextResponse.json({ elevated: true, scopes: payload.scopes });
}

/**
 * DELETE /api/security/elevation — revoga elevation ativa.
 */
export async function DELETE(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  await revokeElevation();
  return NextResponse.json({ ok: true });
}
