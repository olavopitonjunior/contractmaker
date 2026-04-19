import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { countRemainingRecoveryCodes } from "@/lib/security/totp";

/**
 * GET /api/security/2fa/status — retorna se 2FA está ativo + info básica.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const row = await prisma.twoFactorSecret.findUnique({
    where: { userId: ctx.userId },
    select: {
      enabled: true,
      enrolledAt: true,
      lastUsedAt: true,
      recoveryCodesEnc: true,
    },
  });

  if (!row || !row.enabled) {
    return NextResponse.json({
      enabled: false,
      enrolledAt: null,
      lastUsedAt: null,
      recoveryCodesRemaining: 0,
    });
  }

  return NextResponse.json({
    enabled: true,
    enrolledAt: row.enrolledAt,
    lastUsedAt: row.lastUsedAt,
    recoveryCodesRemaining: countRemainingRecoveryCodes(row.recoveryCodesEnc),
  });
}
