import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import {
  generateTotpSecret,
  buildProvisioningUri,
  buildQrCodeDataUrl,
  encryptTotpSecret,
} from "@/lib/security/totp";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/security/2fa/setup
 * Gera um secret TOTP temporário e retorna o QR code.
 * O secret é criptografado e salvo com enabled=false — ativação acontece em /enable.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const existing = await prisma.twoFactorSecret.findUnique({
    where: { userId: ctx.userId },
  });
  if (existing?.enabled) {
    return NextResponse.json(
      { error: "2FA já está ativo para este usuário" },
      { status: 409 }
    );
  }

  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret);
  const provisioningUri = buildProvisioningUri(ctx.userEmail, secret);
  const qrDataUrl = await buildQrCodeDataUrl(provisioningUri);

  await prisma.twoFactorSecret.upsert({
    where: { userId: ctx.userId },
    create: {
      userId: ctx.userId,
      secretEncrypted: encrypted.ciphertext,
      secretIvBase64: encrypted.iv,
      secretTagBase64: encrypted.tag,
      recoveryCodesEnc: "[]",
      enabled: false,
    },
    update: {
      secretEncrypted: encrypted.ciphertext,
      secretIvBase64: encrypted.iv,
      secretTagBase64: encrypted.tag,
      enabled: false,
    },
  });

  return NextResponse.json({
    qrCodeDataUrl: qrDataUrl,
    provisioningUri,
    secret, // fallback manual em caso de app sem câmera
  });
}
